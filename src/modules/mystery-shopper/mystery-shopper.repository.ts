import { ConflictException, Injectable } from '@nestjs/common';
import { ChannelType, MessageDirection, MessageStatus, MysteryShopperVisitStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { phoneVariants } from '../../common/utils/phone.util';
import { messageText } from '../messaging/messages/message-search';
import { MAX_TRANSCRIPT_LINES, NON_CONVERSATIONAL_TYPES, VISIT_LIST_LIMIT } from './mystery-shopper.constants';
import type { CriterionScore, EvaluationResult, VisitMessage } from './mystery-shopper.types';

export interface ActiveNumber {
  id: string;
  organizationId: string;
  contactId: string;
  createdAt: Date;
}

export interface VisitForEvaluation {
  id: string;
  organizationId: string;
  conversationId: string;
  status: MysteryShopperVisitStatus;
  scenario: string | null;
  evaluatedAt: Date | null;
  assignedToId: string | null;
  sellerUserId: string | null;
}

const VISIT_SELECT = {
  id: true,
  status: true,
  scenario: true,
  sellerUserId: true,
  totalScore: true,
  createdAt: true,
  closedAt: true,
  evaluatedAt: true,
  error: true,
  conversationId: true,
  conversation: { select: { assignedToId: true, lastInboundAt: true } },
} satisfies Prisma.MysteryShopperVisitSelect;

const VISIT_DETAIL_SELECT = {
  ...VISIT_SELECT,
  metrics: true,
  scores: true,
  summary: true,
} satisfies Prisma.MysteryShopperVisitSelect;

const NUMBER_SELECT = {
  id: true,
  label: true,
  createdAt: true,
  isSimulated: true,
  channelId: true,
  contact: { select: { phone: true } },
} satisfies Prisma.MysteryShopperNumberSelect;

export type VisitRow = Prisma.MysteryShopperVisitGetPayload<{ select: typeof VISIT_SELECT }>;
export type VisitDetailRow = Prisma.MysteryShopperVisitGetPayload<{ select: typeof VISIT_DETAIL_SELECT }>;
export interface SimulatorNumber {
  id: string;
  label: string;
  isSimulated: boolean;
  contactId: string;
  profileName: string | null;
  contact: { phone: string | null };
  channel: { id: string; type: ChannelType } | null;
}

export interface SimulatorMessageRow {
  id: string;
  direction: MessageDirection;
  status: MessageStatus;
  content: Prisma.JsonValue;
  createdAt: Date;
}

export type NumberRow = Prisma.MysteryShopperNumberGetPayload<{ select: typeof NUMBER_SELECT }>;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const json = (v: unknown) => v as Prisma.InputJsonValue;

/** Todo acesso ao banco do cliente oculto. */
@Injectable()
export class MysteryShopperRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Varredura ───────────────────────────────────────────

  findActiveNumbers(): Promise<ActiveNumber[]> {
    return this.prisma.mysteryShopperNumber.findMany({
      where: { removedAt: null },
      select: { id: true, organizationId: true, contactId: true, createdAt: true },
    });
  }

  async findConversationsWithoutVisit(number: ActiveNumber): Promise<string[]> {
    const rows = await this.prisma.conversation.findMany({
      where: {
        organizationId: number.organizationId,
        contactId: number.contactId,
        isGroup: false,
        deletedAt: null,
        createdAt: { gte: number.createdAt },
        mysteryShopperVisit: { is: null },
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** false = outra varredura criou primeiro (conversation_id é único). */
  async createVisit(number: ActiveNumber, conversationId: string): Promise<boolean> {
    try {
      await this.prisma.mysteryShopperVisit.create({
        data: {
          organizationId: number.organizationId,
          numberId: number.id,
          contactId: number.contactId,
          conversationId,
        },
      });
      return true;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return false;
      throw err;
    }
  }

  async findDueOpenVisitIds(cutoff: Date): Promise<string[]> {
    const rows = await this.prisma.mysteryShopperVisit.findMany({
      where: {
        status: 'OPEN',
        OR: [
          { conversation: { lastInboundAt: { lt: cutoff } } },
          { conversation: { lastInboundAt: null }, createdAt: { lt: cutoff } },
        ],
      },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Visitas em EVALUATING sem andar desde `before` (job perdido ou removido). */
  async findStuckEvaluatingIds(before: Date): Promise<string[]> {
    const rows = await this.prisma.mysteryShopperVisit.findMany({
      where: { status: 'EVALUATING', updatedAt: { lt: before } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Troca para EVALUATING só se ainda estiver num dos status esperados. */
  async markEvaluating(input: {
    id: string;
    organizationId?: string;
    from: MysteryShopperVisitStatus[];
    closedAt: Date;
  }): Promise<boolean> {
    const { count } = await this.prisma.mysteryShopperVisit.updateMany({
      where: {
        id: input.id,
        status: { in: input.from },
        ...(input.organizationId ? { organizationId: input.organizationId } : {}),
      },
      data: { status: 'EVALUATING', closedAt: input.closedAt },
    });
    return count > 0;
  }

  // ── Avaliação ───────────────────────────────────────────

  async findVisitForEvaluation(id: string): Promise<VisitForEvaluation | null> {
    const row = await this.prisma.mysteryShopperVisit.findUnique({
      where: { id },
      select: {
        id: true,
        organizationId: true,
        conversationId: true,
        status: true,
        scenario: true,
        evaluatedAt: true,
        sellerUserId: true,
        conversation: { select: { assignedToId: true } },
      },
    });
    if (!row) return null;
    const { conversation, ...rest } = row;
    return { ...rest, assignedToId: conversation.assignedToId };
  }

  async findMessages(conversationId: string): Promise<VisitMessage[]> {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, revokedAt: null, type: { notIn: [...NON_CONVERSATIONAL_TYPES] } },
      orderBy: { createdAt: 'desc' },
      take: MAX_TRANSCRIPT_LINES,
      select: { id: true, direction: true, senderId: true, content: true, metadata: true, createdAt: true },
    });
    return [...rows].reverse().map((r) => ({
      id: r.id,
      direction: r.direction === 'INBOUND' ? 'INBOUND' : 'OUTBOUND',
      senderId: r.senderId,
      isAutomated: isRecord(r.metadata) && String(r.metadata.automated) === 'true',
      text: messageText(r.content),
      createdAt: r.createdAt,
    }));
  }

  /** Primeira distribuição da conversa (mesmo log que o placar usa). */
  async findFirstAssignment(conversationId: string): Promise<Date | null> {
    const rows = await this.prisma.$queryRaw<Array<{ created_at: Date }>>`
      SELECT l.created_at
        FROM conversation_audit_logs l
       WHERE l.conversation_id = ${conversationId}
         AND l.action = 'ASSIGNED'
         AND l.to_value IS NOT NULL
       ORDER BY l.created_at ASC
       LIMIT 1`;
    return rows[0]?.created_at ?? null;
  }

  countProposals(conversationId: string): Promise<number> {
    return this.prisma.proposal.count({ where: { conversationId } });
  }

  async findUserNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  /**
   * O custo acumula entre avaliações. `increment` não serve: em coluna Decimal nula o SQL
   * devolve NULL (NULL + n). Só um job roda por visita (gate EVALUATING), então ler e somar é seguro.
   */
  async saveEvaluation(id: string, result: EvaluationResult): Promise<void> {
    const previous = await this.prisma.mysteryShopperVisit.findUnique({ where: { id }, select: { costUsd: true } });
    const costUsd = new Prisma.Decimal(previous?.costUsd ?? 0).plus(result.costUsd);
    await this.prisma.mysteryShopperVisit.update({
      where: { id },
      data: {
        status: 'DONE',
        sellerUserId: result.sellerUserId,
        metrics: json(result.metrics),
        scores: json(result.scores),
        totalScore: result.totalScore,
        summary: json(result.summary),
        costUsd,
        evaluatedAt: new Date(),
        error: null,
      },
    });
  }

  /** Falha na reavaliação mantém a avaliação pronta (volta a DONE). */
  async recordFailure(id: string, error: string, keepPrevious: boolean): Promise<void> {
    await this.prisma.mysteryShopperVisit.update({
      where: { id },
      data: { status: keepPrevious ? 'DONE' : 'FAILED', error },
    });
  }

  // ── Página ──────────────────────────────────────────────

  listVisits(organizationId: string): Promise<VisitRow[]> {
    return this.prisma.mysteryShopperVisit.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: VISIT_LIST_LIMIT,
      select: VISIT_SELECT,
    });
  }

  findVisit(organizationId: string, id: string): Promise<VisitDetailRow | null> {
    return this.prisma.mysteryShopperVisit.findFirst({
      where: { id, organizationId },
      select: VISIT_DETAIL_SELECT,
    });
  }

  async updateScenario(organizationId: string, id: string, scenario: string | null): Promise<boolean> {
    const { count } = await this.prisma.mysteryShopperVisit.updateMany({
      where: { id, organizationId },
      data: { scenario },
    });
    return count > 0;
  }

  async discard(organizationId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.mysteryShopperVisit.updateMany({
      where: { id, organizationId, status: { not: 'EVALUATING' } },
      data: { status: 'DISCARDED' },
    });
    return count > 0;
  }

  async findRankingVisits(
    organizationId: string,
    since: Date,
  ): Promise<Array<{ sellerUserId: string; totalScore: number; scores: CriterionScore[] }>> {
    const rows = await this.prisma.mysteryShopperVisit.findMany({
      where: {
        organizationId,
        status: 'DONE',
        sellerUserId: { not: null },
        totalScore: { not: null },
        evaluatedAt: { gte: since },
      },
      select: { sellerUserId: true, totalScore: true, scores: true },
      orderBy: { evaluatedAt: 'asc' }, // o ranking usa o rótulo da visita mais recente (a última)
    });
    return rows.map((r) => ({
      sellerUserId: r.sellerUserId as string,
      totalScore: r.totalScore as number,
      scores: (Array.isArray(r.scores) ? r.scores : []) as unknown as CriterionScore[],
    }));
  }

  listNumbers(organizationId: string): Promise<NumberRow[]> {
    return this.prisma.mysteryShopperNumber.findMany({
      where: { organizationId, removedAt: null },
      orderBy: { createdAt: 'desc' },
      select: NUMBER_SELECT,
    });
  }

  /**
   * Reaproveita o contato pelo telefone como a entrada de mensagens faz
   * (contact-resolver: phoneVariants, o mais antigo). Contato novo nasce SEM
   * nome: o apelido fica só no número, nunca à vista do vendedor.
   */
  addNumber(organizationId: string, phone: string, label: string, userId: string): Promise<NumberRow> {
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.contact.findFirst({
        where: { organizationId, phone: { in: phoneVariants(phone) }, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      const contactId =
        existing?.id ?? (await tx.contact.create({ data: { organizationId, phone }, select: { id: true } })).id;
      const active = await tx.mysteryShopperNumber.findFirst({
        where: { contactId, removedAt: null },
        select: { id: true },
      });
      if (active) throw new ConflictException('Este número já está cadastrado.');
      await tx.contact.update({ where: { id: contactId }, data: { isMysteryShopper: true }, select: { id: true } });
      return tx.mysteryShopperNumber.create({
        data: { organizationId, contactId, label, createdById: userId },
        select: NUMBER_SELECT,
      });
    });
  }

  /** Para de abrir visitas; o contato continua marcado (histórico segue fora dos números). */
  async removeNumber(organizationId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.mysteryShopperNumber.updateMany({
      where: { id, organizationId, removedAt: null },
      data: { removedAt: new Date() },
    });
    return count > 0;
  }

  // ── Cliente simulado ────────────────────────────────────

  findOfficialChannels(organizationId: string): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.channel.findMany({
      where: { organizationId, type: ChannelType.WHATSAPP_OFFICIAL, isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
  }

  findActiveOfficialChannel(organizationId: string, channelId: string): Promise<{ id: string } | null> {
    return this.prisma.channel.findFirst({
      where: { id: channelId, organizationId, type: ChannelType.WHATSAPP_OFFICIAL, isActive: true, deletedAt: null },
      select: { id: true },
    });
  }

  /**
   * Contato + vínculo com o canal + número, numa transação. null = o número
   * sorteado já existe (contato da org ou vínculo no canal; com e sem o 9).
   */
  createSimulatedNumber(
    organizationId: string,
    input: { phone: string; label: string; profileName: string | null; channelId: string; userId: string },
  ): Promise<NumberRow | null> {
    return this.prisma.$transaction(async (tx) => {
      const variants = phoneVariants(input.phone);
      const [contact, link] = await Promise.all([
        tx.contact.findFirst({ where: { organizationId, phone: { in: variants } }, select: { id: true } }),
        tx.contactChannel.findFirst({
          where: { channelId: input.channelId, externalId: { in: variants } },
          select: { id: true },
        }),
      ]);
      if (contact || link) return null;
      const created = await tx.contact.create({
        data: { organizationId, phone: input.phone, name: input.profileName, isMysteryShopper: true },
        select: { id: true },
      });
      await tx.contactChannel.create({
        data: { contactId: created.id, channelId: input.channelId, externalId: input.phone, profileName: input.profileName },
      });
      return tx.mysteryShopperNumber.create({
        data: {
          organizationId,
          contactId: created.id,
          label: input.label,
          createdById: input.userId,
          isSimulated: true,
          channelId: input.channelId,
        },
        select: NUMBER_SELECT,
      });
    });
  }

  /** Número ativo da org, simulado ou não (quem chama decide). */
  async findNumberForSimulator(organizationId: string, id: string): Promise<SimulatorNumber | null> {
    const row = await this.prisma.mysteryShopperNumber.findFirst({
      where: { id, organizationId, removedAt: null },
      select: {
        id: true,
        label: true,
        isSimulated: true,
        contactId: true,
        channelId: true,
        contact: { select: { phone: true } },
        channel: { select: { id: true, type: true } },
      },
    });
    if (!row) return null;
    const link = row.channelId
      ? await this.prisma.contactChannel.findFirst({
          where: { contactId: row.contactId, channelId: row.channelId },
          select: { profileName: true },
        })
      : null;
    return {
      id: row.id,
      label: row.label,
      isSimulated: row.isSimulated,
      contactId: row.contactId,
      profileName: link?.profileName ?? null,
      contact: row.contact,
      channel: row.channel,
    };
  }

  /** Conversa mais recente do contato no canal; últimas `limit` mensagens em ordem cronológica. */
  async findSimulatorMessages(
    contactId: string,
    channelId: string,
    limit: number,
  ): Promise<{ conversationId: string | null; messages: SimulatorMessageRow[] }> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { contactId, channelId, isGroup: false, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!conversation) return { conversationId: null, messages: [] };
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        revokedAt: null,
        type: { notIn: [...NON_CONVERSATIONAL_TYPES] },
        // Saída que falhou (inclui bloqueio da janela de 24h) ou ainda não saiu: o cliente real nunca a recebe.
        NOT: { direction: 'OUTBOUND', status: { in: ['FAILED', 'QUEUED'] } },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, direction: true, status: true, content: true, createdAt: true },
    });
    return { conversationId: conversation.id, messages: [...rows].reverse() };
  }
}
