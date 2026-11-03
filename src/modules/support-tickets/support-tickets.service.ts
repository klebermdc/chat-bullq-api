import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  MessageContentType,
  MessageDirection,
  MessageStatus,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import {
  CLOSED_SUPPORT_STAGE_KEYS,
  OPEN_SUPPORT_STAGE_KEY,
  SUPPORT_CATEGORIES,
  SUPPORT_PIPELINE_KEY,
  SUPPORT_STAGES,
  formatTicketNumber,
  higherPriority,
  type SupportCategory,
  type SupportPriority,
  type SupportTicketSource,
} from "./support-tickets.constants";

/** Tentativas de pegar um número livre quando dois chamados abrem juntos. */
const TICKET_NUMBER_ATTEMPTS = 3;

export interface OpenTicketInput {
  organizationId: string;
  conversationId: string;
  category: SupportCategory;
  priority: SupportPriority;
  summary: string;
  /** Palavras do cliente que justificam o chamado. */
  customerQuote: string | null;
  source: SupportTicketSource;
}

export interface OpenTicketResult {
  cardId: string;
  /** "#S-0042" */
  ticketNumber: string;
  /** false = já havia chamado aberto na conversa e a novidade foi anexada. */
  isNew: boolean;
}

interface TicketEntry {
  at: string;
  category: SupportCategory;
  priority: SupportPriority;
  summary: string;
  customerQuote: string | null;
  source: SupportTicketSource;
}

interface TicketMetadata {
  category: SupportCategory;
  priority: SupportPriority;
  source: SupportTicketSource;
  openedAt: string;
  entries: TicketEntry[];
}

type SupportPipeline = {
  id: string;
  stages: { id: string; key: string | null }[];
};

const CARD_INCLUDE = {
  contact: { select: { id: true, name: true, phone: true, avatarUrl: true } },
  assignedTo: { select: { id: true, name: true, avatarUrl: true } },
} satisfies Prisma.CardInclude;

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/**
 * Chamados de suporte: um card no quadro "Suporte" com número por organização
 * (#S-0042), ligado à conversa e ao vendedor dela. Um chamado aberto por
 * conversa: informação nova entra nele; depois de Resolvido ou Cancelado, o
 * próximo problema abre outro.
 */
@Injectable()
export class SupportTicketsService {
  private readonly logger = new Logger(SupportTicketsService.name);
  // sobrescrito nos testes; produção usa o relógio real
  private clock: () => Date = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async open(input: OpenTicketInput): Promise<OpenTicketResult> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: {
        id: true,
        organizationId: true,
        channelId: true,
        contactId: true,
        assignedToId: true,
        contact: { select: { name: true, phone: true } },
      },
    });
    if (!conversation || conversation.organizationId !== input.organizationId) {
      throw new NotFoundException("Conversa não encontrada");
    }

    const pipeline = await this.ensurePipeline(input.organizationId);
    const entry: TicketEntry = {
      at: this.clock().toISOString(),
      category: input.category,
      priority: input.priority,
      summary: input.summary,
      customerQuote: input.customerQuote,
      source: input.source,
    };

    const existing = await this.prisma.card.findFirst({
      where: {
        organizationId: input.organizationId,
        pipelineId: pipeline.id,
        conversationId: input.conversationId,
        status: "OPEN",
        // Card criado à mão no quadro não tem número: não é chamado.
        ticketNumber: { not: null },
        // `notIn` descarta key nula no SQL; etapa criada à mão também conta.
        stage: {
          OR: [
            { key: null },
            { key: { notIn: [...CLOSED_SUPPORT_STAGE_KEYS] } },
          ],
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const result =
      existing?.ticketNumber != null
        ? await this.appendToTicket(
            { ...existing, ticketNumber: existing.ticketNumber },
            entry,
            input.organizationId,
          )
        : await this.createTicket(
            pipeline,
            conversation,
            entry,
            input.organizationId,
          );

    await this.noteInConversation(
      conversation,
      result.ticketNumber,
      entry,
      result.isNew,
    );
    this.logger.log(
      `[support] ${result.isNew ? "aberto" : "atualizado"} ${result.ticketNumber} conv=${conversation.id} prioridade=${entry.priority} origem=${entry.source}`,
    );
    return result;
  }

  private async createTicket(
    pipeline: SupportPipeline,
    conversation: {
      id: string;
      contactId: string;
      assignedToId: string | null;
      contact: { name: string | null; phone: string | null };
    },
    entry: TicketEntry,
    organizationId: string,
  ): Promise<OpenTicketResult> {
    const stageId =
      pipeline.stages.find((s) => s.key === OPEN_SUPPORT_STAGE_KEY)?.id ??
      pipeline.stages[0]?.id;
    if (!stageId) throw new NotFoundException("Quadro de suporte sem etapas");

    const last = await this.prisma.card.findFirst({
      where: { pipelineId: pipeline.id, stageId },
      orderBy: { order: "desc" },
      select: { order: true },
    });
    const contactName =
      conversation.contact.name || conversation.contact.phone || "Sem nome";
    const metadata: TicketMetadata = {
      category: entry.category,
      priority: entry.priority,
      source: entry.source,
      openedAt: entry.at,
      entries: [entry],
    };

    for (let attempt = 1; ; attempt++) {
      const max = await this.prisma.card.aggregate({
        where: { organizationId },
        _max: { ticketNumber: true },
      });
      const ticketNumber = (max._max.ticketNumber ?? 0) + 1;
      try {
        const card = await this.prisma.card.create({
          data: {
            organizationId,
            pipelineId: pipeline.id,
            stageId,
            ticketNumber,
            title: ticketTitle(
              ticketNumber,
              entry.priority,
              metadata.category,
              contactName,
            ),
            description: entry.summary,
            contactId: conversation.contactId,
            conversationId: conversation.id,
            assignedToId: conversation.assignedToId,
            order: (last?.order ?? -1) + 1,
            metadata: {
              supportTicket: metadata,
            } as unknown as Prisma.InputJsonValue,
          },
          include: CARD_INCLUDE,
        });
        this.realtime.emitToOrg(organizationId, "card:created", { card });
        return {
          cardId: card.id,
          ticketNumber: formatTicketNumber(ticketNumber),
          isNew: true,
        };
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= TICKET_NUMBER_ATTEMPTS)
          throw err;
      }
    }
  }

  private async appendToTicket(
    card: {
      id: string;
      title: string;
      description: string | null;
      ticketNumber: number;
      metadata: Prisma.JsonValue;
    },
    entry: TicketEntry,
    organizationId: string,
  ): Promise<OpenTicketResult> {
    const previous = (
      (card.metadata ?? {}) as { supportTicket?: TicketMetadata }
    ).supportTicket;
    const priority = higherPriority(
      previous?.priority ?? entry.priority,
      entry.priority,
    );
    const metadata: TicketMetadata = {
      category: previous?.category ?? entry.category,
      priority,
      source: previous?.source ?? entry.source,
      openedAt: previous?.openedAt ?? entry.at,
      entries: [...(previous?.entries ?? []), entry],
    };
    const baseTitle = card.title.replace(/^🚨 /, "");

    const updated = await this.prisma.card.update({
      where: { id: card.id },
      data: {
        title: priority === "urgente" ? `🚨 ${baseTitle}` : baseTitle,
        description: [card.description, entry.summary]
          .filter(Boolean)
          .join("\n\n"),
        metadata: {
          ...((card.metadata ?? {}) as Record<string, unknown>),
          supportTicket: metadata,
        } as unknown as Prisma.InputJsonValue,
      },
      include: CARD_INCLUDE,
    });
    this.realtime.emitToOrg(organizationId, "card:updated", { card: updated });
    return {
      cardId: card.id,
      ticketNumber: formatTicketNumber(card.ticketNumber),
      isNew: false,
    };
  }

  /** Mensagem SYSTEM: a equipe vê na conversa, o cliente não. */
  private async noteInConversation(
    conversation: { id: string; channelId: string; contactId: string },
    ticketNumber: string,
    entry: TicketEntry,
    isNew: boolean,
  ): Promise<void> {
    const action = isNew ? "aberto" : "atualizado";
    const text = `🎫 Chamado ${ticketNumber} ${action} (${SUPPORT_CATEGORIES[entry.category]}, prioridade ${entry.priority}): ${entry.summary}`;
    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        type: MessageContentType.SYSTEM,
        status: MessageStatus.SENT,
        sentAt: this.clock(),
        content: { text, supportTicket: ticketNumber },
      },
    });
    this.realtime.emitToChannel(conversation.channelId, "message:new", {
      message,
      conversationId: conversation.id,
      contactId: conversation.contactId,
    });
    this.realtime.emitToConversation(conversation.id, "message:new", {
      message,
    });
  }

  private async ensurePipeline(
    organizationId: string,
  ): Promise<SupportPipeline> {
    const found = await this.findPipeline(organizationId);
    if (found) return found;
    try {
      await this.prisma.pipeline.create({
        data: {
          organizationId,
          key: SUPPORT_PIPELINE_KEY,
          name: "Suporte",
          description:
            "Chamados de clientes com problema. Abertos pela Aline ou pelo canal de urgência.",
          icon: "LifeBuoy",
          color: "amber",
          stages: {
            create: SUPPORT_STAGES.map((s, order) => ({
              key: s.key,
              name: s.name,
              color: s.color,
              type: "NORMAL" as const,
              order,
            })),
          },
        },
      });
    } catch (err) {
      // Outro pedido criou ao mesmo tempo (unique org+key): usa o dele.
      if (!isUniqueViolation(err)) throw err;
    }
    return (await this.findPipeline(organizationId))!;
  }

  private findPipeline(
    organizationId: string,
  ): Promise<SupportPipeline | null> {
    return this.prisma.pipeline.findFirst({
      where: { organizationId, key: SUPPORT_PIPELINE_KEY },
      select: { id: true, stages: { select: { id: true, key: true } } },
    });
  }
}

function ticketTitle(
  ticketNumber: number,
  priority: SupportPriority,
  category: SupportCategory,
  contactName: string,
): string {
  const title = `${formatTicketNumber(ticketNumber)} · ${SUPPORT_CATEGORIES[category]} · ${contactName}`;
  return priority === "urgente" ? `🚨 ${title}` : title;
}
