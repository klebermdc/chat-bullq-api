import { Injectable, Logger } from "@nestjs/common";
import {
  MessageContentType,
  MessageDirection,
  MessageStatus,
} from "@prisma/client";
import { PrismaService } from "../../../../database/prisma.service";
import { RealtimeGateway } from "../../../realtime/realtime.gateway";
import {
  EMERGENCY_CONTACT_TOOL,
  EMERGENCY_PHONE,
  buildEmergencyLink,
  isQuoteFromCustomer,
} from "../../emergency/emergency-contact.util";
import { loadRecentCustomerTexts } from "../customer-evidence";
import { isTeamOnline } from "../team-availability";
import { SupportTicketsService } from "../../../support-tickets/support-tickets.service";
import type { SupportCategory } from "../../../support-tickets/support-tickets.constants";
import { AiTool, ToolContext, ToolResult } from "../tool.types";
import { ReplyToConversationTool } from "./reply-to-conversation.tool";

/** Não repete o contato de emergência na mesma conversa dentro disso. */
const RESEND_WINDOW_MS = 24 * 3600_000;
const MAX_FIELD_LENGTH = 300;

/** Subconjunto das categorias de chamado: a urgência abre um chamado urgente. */
const PROBLEM_CATEGORIES: readonly SupportCategory[] = [
  "ingresso",
  "transfer",
  "hotel",
  "voo",
  "documento_imigracao",
  "saude_seguranca",
  "outro",
];

const ASK_CUSTOMER =
  "NÃO passe o número. Pergunte ao cliente, numa frase, se ele já está no destino agora e o que está acontecendo, e espere a resposta.";

/**
 * Canal de urgência: passageiro JÁ em viagem, com problema urgente, e
 * ninguém da equipe online. Manda ao cliente o link do WhatsApp de
 * emergência e deixa um alerta interno na conversa.
 *
 * Antes de mandar, confere no servidor (não no prompt):
 *  - as frases citadas pela Aline estão mesmo nas mensagens do cliente;
 *  - nenhum atendente está ativo no Chat agora;
 *  - o contato não foi mandado nas últimas 24h.
 *
 * Junto com o link, abre (ou atualiza) um chamado urgente, para a urgência
 * não se perder quando a equipe voltar. Com equipe online, nem um nem outro.
 */
@Injectable()
export class SendEmergencyContactTool implements AiTool {
  private readonly logger = new Logger(SendEmergencyContactTool.name);
  // sobrescrito nos testes; produção usa o relógio real
  private clock: () => Date = () => new Date();

  readonly name = EMERGENCY_CONTACT_TOOL;
  readonly description =
    "Manda ao cliente o link do WhatsApp de emergência. Só para quem JÁ ESTÁ em viagem " +
    "(no destino ou a caminho) com um problema urgente que não pode esperar a equipe voltar. " +
    "Cite as palavras exatas do cliente que provam as duas coisas. O sistema confere as " +
    "citações e só envia se ninguém da equipe estiver online. A mensagem ao cliente é " +
    "enviada pela própria ferramenta: não escreva o número em replyToConversation.";
  readonly parameters = {
    type: "object",
    additionalProperties: false,
    required: [
      "location",
      "tripQuote",
      "urgencyQuote",
      "problemCategory",
      "problem",
    ],
    properties: {
      location: {
        type: "string",
        minLength: 3,
        maxLength: MAX_FIELD_LENGTH,
        description:
          'Onde o passageiro está agora, segundo ele (ex.: "Orlando, no hotel").',
      },
      tripQuote: {
        type: "string",
        minLength: 12,
        maxLength: MAX_FIELD_LENGTH,
        description:
          "Trecho COPIADO da mensagem do cliente que mostra que ele já está em viagem.",
      },
      urgencyQuote: {
        type: "string",
        minLength: 12,
        maxLength: MAX_FIELD_LENGTH,
        description:
          "Trecho COPIADO da mensagem do cliente que descreve o problema urgente.",
      },
      problemCategory: { type: "string", enum: [...PROBLEM_CATEGORIES] },
      problem: {
        type: "string",
        minLength: 5,
        maxLength: MAX_FIELD_LENGTH,
        description:
          "Resumo do problema em uma frase, para a equipe de emergência.",
      },
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly reply: ReplyToConversationTool,
    private readonly tickets: SupportTicketsService,
  ) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const field = (key: string) =>
      String(input[key] ?? "")
        .trim()
        .slice(0, MAX_FIELD_LENGTH);
    const location = field("location");
    const tripQuote = field("tripQuote");
    const urgencyQuote = field("urgencyQuote");
    const problem = field("problem");
    const category = field("problemCategory");
    if (
      !location ||
      !problem ||
      !PROBLEM_CATEGORIES.includes(category as SupportCategory)
    ) {
      return refuse(
        "invalid_input",
        `Preencha onde o cliente está, o problema e uma categoria válida. ${ASK_CUSTOMER}`,
      );
    }

    const now = this.clock();
    if (await this.sentRecently(ctx.conversationId, now)) {
      return refuse(
        "already_sent",
        "O contato de emergência já foi enviado nesta conversa. Não repita o número: lembre o cliente de tocar no link enviado acima.",
      );
    }

    const customerTexts = await loadRecentCustomerTexts(
      this.prisma,
      ctx.conversationId,
      now,
    );
    if (!isQuoteFromCustomer(tripQuote, customerTexts)) {
      return refuse(
        "trip_not_confirmed",
        `O cliente não escreveu que já está em viagem (a citação não bate com as mensagens dele). ${ASK_CUSTOMER}`,
      );
    }
    if (!isQuoteFromCustomer(urgencyQuote, customerTexts)) {
      return refuse(
        "urgency_not_confirmed",
        `O problema urgente não está nas palavras do cliente (a citação não bate). ${ASK_CUSTOMER}`,
      );
    }

    const summary = `Onde: ${location}. Problema (${category}): ${problem}. Cliente disse: "${tripQuote}" / "${urgencyQuote}".`;

    // Com alguém online, a própria equipe atende: sem número e sem chamado.
    if (await isTeamOnline(this.realtime, ctx.organizationId, now)) {
      await this.leaveAlert(
        ctx,
        `🚨 Urgência em viagem, com equipe online (contato de emergência NÃO enviado). ${summary}`,
      );
      return refuse(
        "team_online",
        'Tem atendente online agora: não passe o número de emergência. Diga ao cliente que a equipe já foi avisada e responde em instantes. Se transferToHuman estiver disponível, use com o motivo "urgência em viagem".',
      );
    }

    const ticketNumber = await this.openTicket(
      ctx,
      category as SupportCategory,
      `${problem} (onde: ${location})`,
      urgencyQuote,
    );
    const contact = await this.prisma.contact.findUnique({
      where: { id: ctx.contactId },
      select: { name: true },
    });
    const link = buildEmergencyLink(
      contact?.name ?? null,
      problem,
      ticketNumber,
    );
    const text =
      `Entendi, isso é urgente. Nossa equipe não está online agora, então fale direto com o nosso time de emergência no WhatsApp ${EMERGENCY_PHONE}. ` +
      `É só tocar no link: ${link}`;

    const sent = await this.reply.deliver(text, ctx, {
      emergencyContact: true,
    });
    if ((sent.output as { ok?: boolean })?.ok !== true)
      return { output: sent.output };

    try {
      const ticketNote = ticketNumber ? ` Chamado ${ticketNumber}.` : "";
      await this.leaveAlert(
        ctx,
        `🚨 Urgência em viagem: a Aline passou o WhatsApp de emergência ${EMERGENCY_PHONE}. ${summary}${ticketNote}`,
      );
    } catch (err) {
      // O link já saiu: falhar aqui faria o runner tentar de novo.
      this.logger.error(
        `[emergency] alerta interno falhou conv=${ctx.conversationId}: ${(err as Error).message}`,
      );
    }
    this.logger.warn(
      `[emergency] contato enviado conv=${ctx.conversationId} run=${ctx.runId} categoria=${category}`,
    );
    return { output: { ok: true, sent: true }, finalAction: "REPLIED" };
  }

  /** Chamado urgente da conversa. Falha aqui não pode travar a urgência. */
  private async openTicket(
    ctx: ToolContext,
    category: SupportCategory,
    summary: string,
    customerQuote: string,
  ): Promise<string | null> {
    try {
      const ticket = await this.tickets.open({
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        category,
        priority: "urgente",
        summary,
        customerQuote,
        source: "emergency",
      });
      return ticket.ticketNumber;
    } catch (err) {
      this.logger.error(
        `[emergency] chamado não abriu conv=${ctx.conversationId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async sentRecently(
    conversationId: string,
    now: Date,
  ): Promise<boolean> {
    const previous = await this.prisma.message.findFirst({
      where: {
        conversationId,
        createdAt: { gte: new Date(now.getTime() - RESEND_WINDOW_MS) },
        metadata: { path: ["emergencyContact"], equals: true },
        // Envio que falhou no WhatsApp não chegou: pode mandar de novo.
        status: { not: MessageStatus.FAILED },
      },
      select: { id: true },
    });
    return !!previous;
  }

  /** Mensagem SYSTEM: só a equipe vê, não vai para o WhatsApp. */
  private async leaveAlert(ctx: ToolContext, text: string): Promise<void> {
    const message = await this.prisma.message.create({
      data: {
        conversationId: ctx.conversationId,
        direction: MessageDirection.OUTBOUND,
        type: MessageContentType.SYSTEM,
        status: MessageStatus.SENT,
        sentAt: this.clock(),
        content: { text, emergencyAlert: true },
        metadata: { aiAgentId: ctx.agentId, runId: ctx.runId },
      },
    });
    this.realtime.emitToChannel(ctx.channelId, "message:new", {
      message,
      conversationId: ctx.conversationId,
      contactId: ctx.contactId,
    });
    this.realtime.emitToConversation(ctx.conversationId, "message:new", {
      message,
    });
  }
}

function refuse(error: string, message: string): ToolResult {
  return { output: { ok: false, error, message } };
}
