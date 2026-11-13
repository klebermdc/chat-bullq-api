import { BadRequestException, Injectable } from '@nestjs/common';
import { ConversationStatus, OrgRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  buildDailyScoreboard,
  DailyScoreboard,
  DayAssignmentRow,
  DayBounds,
  LastAssignmentRow,
  localDateKey,
  localDayBounds,
  parseScoreboardDate,
} from './daily-scoreboard.rules';
import { REAL_CONVERSATION } from '../../../common/mystery-shopper.filters';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
const OPEN_STATUSES: ConversationStatus[] = [
  ConversationStatus.PENDING,
  ConversationStatus.OPEN,
  ConversationStatus.WAITING,
];

/**
 * Instante como texto UTC sem fuso, para comparar com colunas `timestamp(3)`
 * no SQL bruto. Um Date como parâmetro seria convertido pelo fuso da sessão
 * do Postgres e deslocaria o dia.
 */
const utcTimestamp = (at: Date): string => at.toISOString().replace('T', ' ').replace('Z', '');

/**
 * Origem do log ASSIGNED (`l`, com a conversa `c`). Logs gravados antes de
 * existir `metadata.source` são deduzidos: de outro vendedor é transferência;
 * sem autor (ou o próprio vendedor) com o contato na carteira legada é
 * carteira; o próprio vendedor é `self`; o resto é distribuição.
 */
const ASSIGNMENT_SOURCE_SQL = Prisma.sql`
  COALESCE(
    l.metadata->>'source',
    CASE
      WHEN l.from_value IS NOT NULL AND l.from_value <> l.to_value THEN 'transfer'
      WHEN (l.actor_id IS NULL OR l.actor_id = l.to_value)
           AND EXISTS (SELECT 1 FROM contacts k, buscar_vendedor_legado(k.phone) lg
                        WHERE k.id = c.contact_id) THEN 'legacy_owner'
      WHEN l.actor_id = l.to_value THEN 'self'
      ELSE 'distribution'
    END)`;

/**
 * Placar do dia por vendedor, para o OFP Hub (API pública, chave `pk_`).
 * Só leitura. As regras de cada número ficam em daily-scoreboard.rules.ts.
 */
@Injectable()
export class DailyScoreboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDailyScoreboard(organizationId: string, rawDate?: string): Promise<DailyScoreboard> {
    const timezone = await this.timezoneOf(organizationId);
    const generatedAt = new Date();
    const date = rawDate ? parseScoreboardDate(rawDate) : localDateKey(generatedAt, timezone);
    if (!date) throw new BadRequestException('date inválida (use YYYY-MM-DD)');
    const day = localDayBounds(date, timezone);

    const openConversations = await this.openConversations(organizationId);
    const assignedOpenIds = openConversations.filter((c) => c.assignedToId).map((c) => c.id);
    const [lastAssignments, dayAssignments, closedTodayByAgent, enteredToday, rosterIds] = await Promise.all([
      this.lastAssignments(assignedOpenIds),
      this.dayAssignments(organizationId, day),
      this.closedTodayByAgent(organizationId, day),
      this.enteredToday(organizationId, day),
      this.rosterIds(organizationId),
    ]);

    const agentIds = new Set<string>([
      ...rosterIds,
      ...closedTodayByAgent.keys(),
      ...dayAssignments.map((a) => a.agentId),
      ...openConversations.flatMap((c) => (c.assignedToId ? [c.assignedToId] : [])),
    ]);
    const agents = await this.prisma.user.findMany({
      where: { id: { in: [...agentIds] } },
      select: { id: true, name: true, avatarUrl: true },
    });

    return buildDailyScoreboard({
      date,
      timezone,
      generatedAt,
      openConversations,
      lastAssignments,
      dayAssignments,
      closedTodayByAgent,
      enteredToday,
      agents: agents.map((a) => ({ id: a.id, name: a.name, avatarUrl: a.avatarUrl ?? null })),
      rosterIds,
      day,
    });
  }

  private async timezoneOf(organizationId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { aiTimezone: true },
    });
    return org?.aiTimezone || DEFAULT_TIMEZONE;
  }

  /** Filtro comum: conversa real (sem grupo, apagada, arquivada ou de cliente oculto) da org. */
  private baseWhere(organizationId: string): Prisma.ConversationWhereInput {
    return { organizationId, isGroup: false, deletedAt: null, isArchived: false, ...REAL_CONVERSATION };
  }

  private openConversations(organizationId: string) {
    return this.prisma.conversation.findMany({
      where: { ...this.baseWhere(organizationId), status: { in: OPEN_STATUSES } },
      select: {
        id: true,
        assignedToId: true,
        createdAt: true,
        reopenedAt: true,
        lastHumanReplyAt: true,
        awaitingHumanReply: true,
        lastInboundAt: true,
      },
    });
  }

  /** Log ASSIGNED mais recente de cada conversa aberta com dono. */
  private async lastAssignments(conversationIds: string[]): Promise<LastAssignmentRow[]> {
    if (conversationIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<
      Array<{ conversation_id: string; agent_id: string; assigned_at: Date; source: string }>
    >`
      SELECT DISTINCT ON (l.conversation_id)
             l.conversation_id, l.to_value AS agent_id, l.created_at AS assigned_at,
             ${ASSIGNMENT_SOURCE_SQL} AS source
        FROM conversation_audit_logs l
        JOIN conversations c ON c.id = l.conversation_id
       WHERE l.action = 'ASSIGNED'
         AND l.to_value IS NOT NULL
         AND l.conversation_id = ANY(${conversationIds}::text[])
       ORDER BY l.conversation_id, l.created_at DESC`;
    return rows.map((r) => ({
      conversationId: r.conversation_id,
      agentId: r.agent_id,
      assignedAt: r.assigned_at,
      source: r.source,
    }));
  }

  /**
   * Atribuições do dia: uma linha por (conversa, vendedor) com a atribuição
   * mais cedo do dia (e a origem dela) e a 1ª mensagem do próprio vendedor depois dela (envio
   * automático em nome dele não conta).
   */
  private async dayAssignments(organizationId: string, day: DayBounds): Promise<DayAssignmentRow[]> {
    const rows = await this.prisma.$queryRaw<
      Array<{
        conversation_id: string;
        agent_id: string;
        assigned_at: Date;
        source: string;
        last_human_reply_at: Date | null;
        first_reply_at: Date | null;
      }>
    >`
      WITH day_logs AS (
        SELECT DISTINCT ON (l.conversation_id, l.to_value)
               l.conversation_id, l.to_value AS agent_id, l.created_at AS assigned_at,
               ${ASSIGNMENT_SOURCE_SQL} AS source
          FROM conversation_audit_logs l
          JOIN conversations c ON c.id = l.conversation_id
          JOIN contacts k ON k.id = c.contact_id
         WHERE c.organization_id = ${organizationId}
           AND k.is_mystery_shopper = false
           AND c.is_group = false AND c.deleted_at IS NULL AND c.is_archived = false
           AND l.action = 'ASSIGNED'
           AND l.to_value IS NOT NULL
           AND l.created_at >= ${utcTimestamp(day.start)}::timestamp
           AND l.created_at < ${utcTimestamp(day.end)}::timestamp
         ORDER BY l.conversation_id, l.to_value, l.created_at
      )
      SELECT d.conversation_id, d.agent_id, d.assigned_at, d.source, c.last_human_reply_at,
             (SELECT MIN(m.created_at)
                FROM messages m
               WHERE m.conversation_id = d.conversation_id
                 AND m.direction = 'OUTBOUND'
                 AND m.sender_id = d.agent_id
                 AND m.created_at >= d.assigned_at
                 AND COALESCE(m.metadata->>'automated', 'false') <> 'true') AS first_reply_at
        FROM day_logs d
        JOIN conversations c ON c.id = d.conversation_id`;
    return rows.map((r) => ({
      conversationId: r.conversation_id,
      agentId: r.agent_id,
      assignedAt: r.assigned_at,
      source: r.source,
      lastHumanReplyAt: r.last_human_reply_at,
      firstReplyAt: r.first_reply_at,
    }));
  }

  private async closedTodayByAgent(organizationId: string, day: DayBounds): Promise<Map<string, number>> {
    const groups = await this.prisma.conversation.groupBy({
      by: ['assignedToId'],
      where: {
        ...this.baseWhere(organizationId),
        assignedToId: { not: null },
        closedAt: { gte: day.start, lt: day.end },
      },
      _count: { _all: true },
    });
    return new Map(
      groups.flatMap((g) => (g.assignedToId ? [[g.assignedToId, g._count._all] as [string, number]] : [])),
    );
  }

  private enteredToday(organizationId: string, day: DayBounds): Promise<number> {
    const inDay = { gte: day.start, lt: day.end };
    return this.prisma.conversation.count({
      where: { ...this.baseWhere(organizationId), OR: [{ createdAt: inDay }, { reopenedAt: inDay }] },
    });
  }

  /** Atendentes ativos da org: aparecem no placar mesmo zerados. */
  private async rosterIds(organizationId: string): Promise<Set<string>> {
    const members = await this.prisma.userOrganization.findMany({
      where: { organizationId, role: OrgRole.AGENT, user: { isActive: true, deletedAt: null } },
      select: { userId: true },
    });
    return new Set(members.map((m) => m.userId));
  }
}
