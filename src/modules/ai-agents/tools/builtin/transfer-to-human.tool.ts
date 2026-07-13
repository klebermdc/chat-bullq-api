import { Injectable, Logger } from '@nestjs/common';
import { RealtimeGateway } from '../../../realtime/realtime.gateway';
import { PrismaService } from '../../../../database/prisma.service';
import { PendingActionService } from '../../confirmations/pending-action.service';
import { AiTool, ToolContext, ToolResult } from '../tool.types';
import { ReplyToConversationTool } from './reply-to-conversation.tool';
import { enterLeadStage } from '../../lead-stage.util';

/** Mensagem que a IA manda pro cliente ao transferir — garantida por código. */
const TRANSITION_MESSAGE =
  'Perfeito! Já tenho tudo que preciso 😊 Vou te passar agora pra um dos nossos consultores finalizar com você. Em instantes alguém continua por aqui! 💙';

/**
 * Hands the conversation off to a human. Pauses AI on this conversation
 * (so the agent stops responding), moves status to PENDING (so it shows
 * up in the queue), and clears the active agent.
 *
 * Fase 2: a operação real ficou atrás de aprovação humana. A tool agora
 * cria um `PendingAction` (impact=critical) e devolve `requiresUserAction`
 * pro LLM. Quando aprovada, o executor da fase 2 faz o pause/handoff de
 * verdade. Mantemos a notificação imediata pro operador (via realtime)
 * pra ele revisar a fila de pendências sem demora.
 */
@Injectable()
export class TransferToHumanTool implements AiTool {
  private readonly logger = new Logger(TransferToHumanTool.name);

  readonly name = 'transferToHuman';
  readonly description =
    'Hand the conversation over to a human agent. Use this when: the request is outside your competence, the customer explicitly asks for a person, the situation is sensitive (complaint, refund, anger), or you are uncertain. The conversation will move to the queue and AI will be paused.';
  readonly parameters = {
    type: 'object',
    additionalProperties: false,
    required: ['reason'],
    properties: {
      reason: {
        type: 'string',
        description:
          'Short reason for the handoff, in PT-BR. Visible to the human as an internal note. e.g., "Cliente pediu reembolso, fora do meu escopo".',
        minLength: 3,
        maxLength: 500,
      },
      summary: {
        type: 'string',
        description:
          'Optional short summary of the conversation so far so the human picks up faster.',
        maxLength: 1000,
      },
    },
  };

  constructor(
    private readonly realtime: RealtimeGateway,
    private readonly pendingActions: PendingActionService,
    private readonly prisma: PrismaService,
    private readonly replyTool: ReplyToConversationTool,
  ) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const reason = String(input.reason ?? '').trim() || 'Handoff sem motivo informado';
    const summary = input.summary ? String(input.summary).trim() : null;

    // ── Efeitos determinísticos do handoff (best-effort — nunca quebram a
    //    pendência, que é o essencial). Feitos POR CÓDIGO pra não depender do
    //    modelo lembrar de avisar/taguear/criar card. ──────────────────────
    // 1) Avisa o cliente (mensagem de transição garantida).
    try {
      await this.replyTool.execute({ text: TRANSITION_MESSAGE }, ctx);
    } catch (e) {
      this.logger.warn(`transfer: falha ao avisar cliente (conv=${ctx.conversationId}): ${(e as Error)?.message}`);
    }
    // 2) Card no funil "Vendas OFP", etapa "Distribuir" (a ETAPA é o status do
    //    funil — não usamos mais tag "distribuir", que era redundante).
    try {
      await this.createVendasOfpCard(ctx);
    } catch (e) {
      this.logger.warn(`transfer: falha ao criar card (conv=${ctx.conversationId}): ${(e as Error)?.message}`);
    }

    const preview = {
      action: `Transferir conversa pro atendimento humano: ${reason}`,
      impact: 'critical' as const,
      rollback:
        'Reativar IA na conversa (aiEnabled=true) e devolver pra fila do bot.',
      affectedEntity: {
        type: 'conversation' as const,
        id: ctx.conversationId,
        label: `conversation:${ctx.conversationId}`,
      },
    };

    const action = await this.pendingActions.create({
      agentRunId: ctx.runId,
      conversationId: ctx.conversationId,
      agentId: ctx.agentId,
      toolName: this.name,
      args: { reason, summary },
      preview,
    });

    // Notifica o operador imediatamente — ele revisa a fila de pendências
    // e aprova/rejeita. A pausa da IA acontece SOMENTE após aprovação,
    // pelo executor da fase 2.
    this.realtime.emitToConversation(
      ctx.conversationId,
      'conversation:pending-action',
      {
        conversationId: ctx.conversationId,
        pendingActionId: action.id,
        toolName: this.name,
        impact: preview.impact,
        reason,
      },
    );

    this.logger.log(
      `Agent ${ctx.agentId} requested handoff for conv ${ctx.conversationId} → pendingAction=${action.id} (reason="${reason}")`,
    );

    return {
      output: {
        ok: true,
        status: 'queued_for_processing',
        pendingActionId: action.id,
        preview,
        message:
          'Transferência concluída: o cliente JÁ foi avisado e o card entrou no funil (etapa Distribuir). NÃO escreva mais nada — o atendente humano assume agora.',
        agent_should_say: '',
      },
      // Mantém o sinal de "saí do loop" — o agent deve parar de responder
      // até o operador decidir. Sem isso o LLM seguiria conversando como
      // se tivesse transferido de fato.
      finalAction: 'TRANSFERRED_TO_HUMAN',
    };
  }

  /**
   * Cria um card pro lead no pipeline "Vendas OFP" (primeira etapa), pra o time
   * distribuir/trabalhar de lá. Best-effort: se o pipeline não existir ou já
   * houver card da conversa, apenas loga e segue.
   */
  private async createVendasOfpCard(ctx: ToolContext): Promise<void> {
    // Lead qualificado entra no funil "Vendas OFP" na etapa "Distribuir"
    // (aguardando o ADM distribuir pra um atendente).
    const stageId = await enterLeadStage(this.prisma, {
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      contactId: ctx.contactId,
      stageContains: 'distribu',
    });
    if (!stageId) {
      this.logger.warn(
        `transfer: pipeline "Vendas"/etapa "Distribuir" não encontrado (org=${ctx.organizationId}) — card não criado`,
      );
      return;
    }
    this.logger.log(
      `transfer: card do lead entrou na etapa "Distribuir" (conv=${ctx.conversationId})`,
    );
  }
}
