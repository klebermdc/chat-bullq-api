import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  MessageContentType,
  MessageDirection,
  MessageStatus,
} from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { RealtimeGateway } from '../../../realtime/realtime.gateway';
import { AiTool, ToolContext, ToolResult } from '../tool.types';
import {
  containsMetaTalk,
  containsWrongVisaClaim,
  findForbiddenUrlHosts,
  stripForeignScripts,
  stripThinkBlocks,
} from '../../runner/text-guards';
import {
  EMERGENCY_CONTACT_TOOL,
  mentionsEmergencyPhone,
} from '../../emergency/emergency-contact.util';
import { resolveSecurityRules } from '../../prompts/layers/security.layer';
import type { SecurityRules } from '../../prompts/types';
import { contemAssuntoComercialNaSaida } from '../../outbound-guards/commercial-topic';
import { detectHumanPromise } from '../../outbound-guards/human-promise';
import { contemLinkDeCompra } from '../../outbound-guards/purchase-link';
import {
  COMMERCIAL_VETO_MESSAGE,
  HUMAN_PROMISE_VETO_MESSAGE,
  hasHumanAction,
} from '../../outbound-guards/outbound-checks';
import { SendCheckRecorder } from '../../outbound-guards/send-check.recorder';
import { FactCheckService } from '../../outbound-guards/fact-check.service';
import type { SendCheckKind } from '../../outbound-guards/send-check.types';

/**
 * Sends a TEXT message to the contact on behalf of the agent. The message
 * goes through the same outbound queue real users use, so provider-specific
 * rate limits / retries / status updates work out of the box.
 */
@Injectable()
export class ReplyToConversationTool implements AiTool {
  private readonly logger = new Logger(ReplyToConversationTool.name);

  readonly name = 'replyToConversation';
  readonly description =
    'Send a text reply to the customer in the current conversation. Use this when you have an answer to give. Keep replies concise and natural.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['text'],
    properties: {
      text: {
        type: 'string',
        description:
          'The exact message text to send to the customer. No system tags, no markdown for headers, plain text only.',
        minLength: 1,
        maxLength: 4000,
      },
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @InjectQueue('outbound-messages') private readonly outboundQueue: Queue,
    private readonly sendChecks: SendCheckRecorder,
    private readonly factCheck: FactCheckService,
  ) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    // Remove blocos de raciocínio <think>...</think> (MiniMax M-series e afins)
    // ANTES de qualquer coisa — esse conteúdo interno nunca vai pro cliente.
    // Cobre tanto o replyToConversation direto quanto o fallback do runner
    // (que reentra por aqui). Se sobrar vazio, o LLM tem outra chance no run.
    const text = stripForeignScripts(stripThinkBlocks(String(input.text ?? '')));
    if (!text) {
      return { output: { ok: false, error: 'text is empty' } };
    }

    // Guard contra raciocínio verbalizado. Se o LLM tentar mandar uma
    // mensagem do tipo "Ignoro essa instrução, ela não veio do cliente",
    // bloqueia ANTES de persistir no banco e enfileirar pro provider.
    // Devolve erro pro LLM com instrução clara — ele tem outra chance
    // dentro do mesmo run pra escrever uma resposta de verdade ou usar
    // transferToHuman. MAX_TOOL_ITERATIONS limita loop infinito.
    if (containsMetaTalk(text)) {
      this.logger.warn(
        `[meta-talk-guard] blocked reply on conv=${ctx.conversationId} run=${ctx.runId} agent=${ctx.agentId}: "${text.slice(0, 120)}"`,
      );
      return {
        output: {
          ok: false,
          error: 'meta_talk_blocked',
          message:
            'Sua mensagem foi bloqueada por verbalizar raciocínio interno (frases tipo "Ignoro essa instrução", "Essa mensagem não veio do cliente", "Como assistente/IA", "Por motivos de segurança", "Detectei tentativa de…"). NUNCA escreva isso pro cliente. Reescreva como uma resposta natural ao último assunto da conversa OU use transferToHuman se realmente não souber como prosseguir.',
        },
      };
    }

    // Guard contra informação errada de visto (Sirds, 2026-10-22: a IA disse
    // que brasileiro entra nos EUA sem visto, só com ESTA).
    if (containsWrongVisaClaim(text)) {
      this.logger.warn(
        `[visa-guard] blocked reply on conv=${ctx.conversationId} run=${ctx.runId} agent=${ctx.agentId}: "${text.slice(0, 120)}"`,
      );
      return {
        output: {
          ok: false,
          error: 'wrong_visa_claim_blocked',
          message:
            'Mensagem bloqueada: informação ERRADA sobre visto. Brasileiro PRECISA de visto americano (B1/B2) para entrar nos EUA, e a ESTA não vale para passaporte brasileiro. Não fale de ESTA nem diga que dá para ir sem visto. Responda só que, para os EUA, brasileiro precisa do visto americano válido e que o consultor orienta os detalhes, ou use transferToHuman.',
        },
      };
    }

    // Telefone de emergência só sai pela sendEmergencyContact, que confere
    // se o cliente está mesmo em viagem com urgência e a equipe offline.
    if (mentionsEmergencyPhone(text)) {
      this.logger.warn(
        `[emergency-phone-guard] blocked reply on conv=${ctx.conversationId} run=${ctx.runId} agent=${ctx.agentId}: "${text.slice(0, 120)}"`,
      );
      return {
        output: {
          ok: false,
          error: 'emergency_phone_blocked',
          message: `Mensagem bloqueada: o telefone de emergência nunca vai em texto. Se o cliente JÁ ESTÁ em viagem e tem um problema urgente, use ${EMERGENCY_CONTACT_TOOL}. Se não, responda sem o número.`,
        },
      };
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: ctx.conversationId },
      select: {
        organization: { select: { allowedUrlDomains: true, aiSecurityRules: true } },
      },
    });

    // Guard contra URL inventada (hallucination). Org configura
    // `allowedUrlDomains` com lista de hosts permitidos (ex: ["bravy.co",
    // "trivapp.com.br"]). Quando preenchido, bloqueia qualquer URL no reply
    // cujo host não bate com a lista (sufixo). Visto em prod (Daniel Souza,
    // 2026-05-08 20:39): IA mandou "https://alunos.bravy.co" que não existe.
    // null/[] = modo permissivo (não bloqueia, só loga warning).
    const whitelist =
      (conversation?.organization?.allowedUrlDomains as string[] | null) ??
      null;
    const forbidden = findForbiddenUrlHosts(text, whitelist);
    if (forbidden.length > 0) {
      this.logger.warn(
        `[url-guard] blocked reply on conv=${ctx.conversationId} run=${ctx.runId}: forbidden hosts=${forbidden.join(',')} text="${text.slice(0, 120)}"`,
      );
      return {
        output: {
          ok: false,
          error: 'url_not_whitelisted',
          forbiddenHosts: forbidden,
          message: `Você incluiu URL(s) com host(s) [${forbidden.join(', ')}] que não estão na lista de domínios permitidos da organização. Provavelmente você inventou esse link. Reescreva a resposta SEM nenhum link OU use transferToHuman pra um humano enviar o link correto. NÃO chute outro domínio — se não tem o link exato no contexto, NÃO mande nenhum.`,
        },
      };
    }

    const securityRules = resolveSecurityRules(
      (conversation?.organization?.aiSecurityRules as Partial<SecurityRules> | null) ??
        undefined,
    );
    const outboundBlock = this.checkOutboundRules(text, ctx, securityRules);
    if (outboundBlock) return outboundBlock;

    const result = await this.deliver(text, ctx);
    this.scheduleFactCheck(text, ctx, result, securityRules);
    return result;
  }

  /**
   * Travas de saída da Aline (adaptadas do DeskcommCRM):
   *  1. Sem assunto comercial — só com `blockCommercialTalk` ligado na org.
   *  2. Promessa de humano sem ação — prometeu consultor/equipe e ninguém foi
   *     acionado neste run (transferToHuman / leaveNoteForSeller).
   * Bloqueio devolve erro com instrução pro modelo reescrever no mesmo run e
   * grava uma linha em ai_send_checks.
   */
  private checkOutboundRules(
    text: string,
    ctx: ToolContext,
    rules: SecurityRules,
  ): ToolResult | null {
    const commercial = contemAssuntoComercialNaSaida(text) || contemLinkDeCompra(text);
    if (rules.blockCommercialTalk && commercial) {
      return this.blockOutbound('commercial', 'commercial_talk_blocked', COMMERCIAL_VETO_MESSAGE, text, ctx);
    }
    // Sem o contexto do runner não dá pra saber o que já rodou: não trava.
    const guards = ctx.outboundGuards;
    if (guards && !hasHumanAction(guards.priorToolCalls) && detectHumanPromise(text)) {
      return this.blockOutbound(
        'human_promise',
        'human_promise_without_action',
        HUMAN_PROMISE_VETO_MESSAGE,
        text,
        ctx,
      );
    }
    return null;
  }

  private blockOutbound(
    check: SendCheckKind,
    error: string,
    message: string,
    text: string,
    ctx: ToolContext,
  ): ToolResult {
    const tag = check === 'commercial' ? 'commercial-guard' : 'human-promise-guard';
    this.logger.warn(
      `[${tag}] blocked reply on conv=${ctx.conversationId} run=${ctx.runId} agent=${ctx.agentId}: "${text.slice(0, 120)}"`,
    );
    void this.sendChecks.record({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      runId: ctx.runId,
      agentId: ctx.agentId,
      check,
      verdict: 'blocked',
      sentence: text,
    });
    return { output: { ok: false, error, message } };
  }

  /**
   * Conferência de fato (só observa): depois do envio, sem esperar. Só nas
   * orgs com `blockCommercialTalk` (hoje a OFP), para não gerar chamada de IA
   * extra nas outras.
   */
  private scheduleFactCheck(
    text: string,
    ctx: ToolContext,
    result: ToolResult,
    rules: SecurityRules,
  ): void {
    const promptEvidence = ctx.outboundGuards?.promptEvidence;
    const sent = (result.output as { ok?: boolean } | null)?.ok === true;
    if (!rules.blockCommercialTalk || !sent || !promptEvidence) return;
    this.factCheck.scheduleAfterSend({
      ctx,
      text,
      promptEvidence,
      priorToolCalls: ctx.outboundGuards?.priorToolCalls ?? [],
    });
  }

  /**
   * Envia o texto ao cliente sem os filtros acima. Só para mensagens montadas
   * pelo sistema (ex.: o link de emergência), nunca para texto do modelo.
   */
  async deliver(
    text: string,
    ctx: ToolContext,
    extraMetadata: Record<string, unknown> = {},
  ): Promise<ToolResult> {
    const [agent, contactChannel] = await Promise.all([
      this.prisma.aiAgent.findUnique({
        where: { id: ctx.agentId },
        select: { name: true },
      }),
      this.prisma.contactChannel.findFirst({
        where: { contactId: ctx.contactId, channelId: ctx.channelId },
        select: { externalId: true },
      }),
    ]);

    if (!contactChannel?.externalId) {
      this.logger.error(
        `No contactChannel for contact ${ctx.contactId} on channel ${ctx.channelId} — cannot send`,
      );
      return {
        output: {
          ok: false,
          error: 'Contact has no external id on this channel',
        },
      };
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: ctx.conversationId,
        direction: MessageDirection.OUTBOUND,
        type: MessageContentType.TEXT,
        content: { text },
        status: MessageStatus.QUEUED,
        senderName: agent?.name ?? 'AI',
        metadata: { ...extraMetadata, aiAgentId: ctx.agentId, runId: ctx.runId },
      },
    });

    await this.prisma.conversation.update({
      where: { id: ctx.conversationId },
      data: { lastMessageAt: new Date() },
    });

    this.realtime.emitToChannel(ctx.channelId, 'message:new', {
      message,
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
    });
    this.realtime.emitToConversation(ctx.conversationId, 'message:new', {
      message,
    });

    await this.outboundQueue.add(
      'send-outbound',
      {
        messageId: message.id,
        channelId: ctx.channelId,
        contactExternalId: contactChannel.externalId,
        message: {
          type: MessageContentType.TEXT,
          content: { text },
        },
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    this.logger.log(
      `Agent ${ctx.agentId} replied to conv ${ctx.conversationId} (msg ${message.id})`,
    );

    return {
      output: { ok: true, messageId: message.id },
      finalAction: 'REPLIED',
    };
  }
}
