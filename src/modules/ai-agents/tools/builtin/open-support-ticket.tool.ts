import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../database/prisma.service";
import { RealtimeGateway } from "../../../realtime/realtime.gateway";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_PRIORITIES,
  isSupportCategory,
  isSupportPriority,
} from "../../../support-tickets/support-tickets.constants";
import { SupportTicketsService } from "../../../support-tickets/support-tickets.service";
import { isQuoteFromCustomer } from "../../emergency/emergency-contact.util";
import { loadRecentCustomerTexts } from "../customer-evidence";
import { isTeamOnline } from "../team-availability";
import { AiTool, ToolContext, ToolResult } from "../tool.types";

export const OPEN_SUPPORT_TICKET_TOOL = "openSupportTicket";

const MAX_SUMMARY_LENGTH = 500;
const MAX_QUOTE_LENGTH = 300;

/**
 * Abre (ou atualiza) o chamado de suporte da conversa quando o cliente relata
 * um problema que precisa da equipe e NINGUÉM da equipe está online. Com
 * alguém online, a equipe atende na hora e não há chamado. A citação do
 * cliente é conferida no servidor. A Aline passa o número ao cliente com
 * replyToConversation.
 */
@Injectable()
export class OpenSupportTicketTool implements AiTool {
  readonly name = OPEN_SUPPORT_TICKET_TOOL;
  readonly description =
    "Abre um chamado de suporte para a equipe quando o cliente relata um problema que precisa de ação " +
    "(ingresso, reserva, transfer, hotel, voo, documento, pagamento, reembolso, troca, reclamação). " +
    "Só abre quando ninguém da equipe está online. Se a conversa já tem chamado aberto, a informação " +
    "nova entra nele. Devolve o número do chamado " +
    "para você passar ao cliente. Não use para cotação nem para dúvida que você mesma responde.";
  readonly parameters = {
    type: "object",
    additionalProperties: false,
    required: ["category", "priority", "summary", "customerQuote"],
    properties: {
      category: { type: "string", enum: Object.keys(SUPPORT_CATEGORIES) },
      priority: {
        type: "string",
        enum: [...SUPPORT_PRIORITIES],
        description:
          "urgente = cliente já em viagem e o problema é agora; alta = viagem nos próximos 7 dias ou dinheiro envolvido; normal = o resto.",
      },
      summary: {
        type: "string",
        minLength: 5,
        maxLength: MAX_SUMMARY_LENGTH,
        description:
          "Resumo objetivo para a equipe: o que aconteceu, produto, datas, o que o cliente pede.",
      },
      customerQuote: {
        type: "string",
        minLength: 12,
        maxLength: MAX_QUOTE_LENGTH,
        description:
          "Trecho COPIADO da mensagem do cliente que descreve o problema.",
      },
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: SupportTicketsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async execute(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolResult> {
    const category = String(input.category ?? "").trim();
    const priority = String(input.priority ?? "").trim();
    const summary = String(input.summary ?? "")
      .trim()
      .slice(0, MAX_SUMMARY_LENGTH);
    const customerQuote = String(input.customerQuote ?? "")
      .trim()
      .slice(0, MAX_QUOTE_LENGTH);
    if (
      !summary ||
      !isSupportCategory(category) ||
      !isSupportPriority(priority)
    ) {
      return refuse(
        "invalid_input",
        "Preencha o resumo, uma categoria e uma prioridade válidas.",
      );
    }

    const now = new Date();
    if (await isTeamOnline(this.realtime, ctx.organizationId, now)) {
      return refuse(
        "team_online",
        "Tem gente da equipe online agora: não abra chamado e não fale em número de chamado. Diga ao cliente que a equipe vai olhar isso já. Se transferToHuman estiver disponível, use com o resumo do problema.",
      );
    }

    const customerTexts = await loadRecentCustomerTexts(
      this.prisma,
      ctx.conversationId,
      now,
    );
    if (!isQuoteFromCustomer(customerQuote, customerTexts)) {
      return refuse(
        "quote_not_found",
        "A citação não bate com as mensagens do cliente. Copie as palavras exatas dele; se o problema não está claro, pergunte numa frase o que aconteceu.",
      );
    }

    const ticket = await this.tickets.open({
      organizationId: ctx.organizationId,
      conversationId: ctx.conversationId,
      category,
      priority,
      summary,
      customerQuote,
      source: "aline",
    });
    const n = ticket.ticketNumber;
    return {
      output: {
        ok: true,
        ticketNumber: n,
        isNew: ticket.isNew,
        message: ticket.isNew
          ? `Chamado ${n} aberto. Diga ao cliente o número ${n}, exatamente assim, e que a equipe de suporte responde por aqui.`
          : `A conversa já tinha o chamado ${n} aberto; a informação nova foi anexada. Diga ao cliente que o chamado ${n} foi atualizado.`,
      },
    };
  }
}

function refuse(error: string, message: string): ToolResult {
  return { output: { ok: false, error, message } };
}
