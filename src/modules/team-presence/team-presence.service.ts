import { Injectable } from '@nestjs/common';
import { ConversationStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import {
  formatReturn,
  isWithinHours,
  nextOpenAt,
  type BusinessHoursConfig,
} from '../routing/availability/business-hours.util';
import { dayKey, groupPresence, presenceStatus, type PresenceStatus } from './presence.util';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
const STATUS_ORDER: Record<PresenceStatus, number> = { online: 0, away: 1, offline: 2 };

export interface TeamPresenceRow {
  userId: string;
  name: string;
  role: string;
  status: PresenceStatus;
  lastActiveAt: string | null;
  schedule: {
    configured: boolean;
    withinHours: boolean | null;
    /** Fora do horário: quando volta ("amanhã às 9h"). */
    returnsAt: string | null;
    /** Aline de plantão cobrindo este atendente agora. */
    onCall: boolean;
  };
  /** Conversas dele em que o cliente espera resposta (aba Esperando). */
  waitingCount: number;
  lastHumanReplyAt: string | null;
  today: { onlineMinutes: number; activeMinutes: number; firstSeenAt: string | null };
  period: { onlineMinutes: number; activeMinutes: number; daysOnline: number };
}

/** Painel "Equipe agora": quem está online e quanto tempo cada um ficou. */
@Injectable()
export class TeamPresenceService {
  // sobrescrito nos testes; produção usa o relógio real
  private clock: () => Date = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async getTeamPresence(
    organizationId: string,
    range: { from: Date; to: Date },
    scopeUserId?: string,
  ): Promise<TeamPresenceRow[]> {
    const now = this.clock();
    const members = await this.prisma.userOrganization.findMany({
      where: {
        organizationId,
        user: { isActive: true, deletedAt: null },
        ...(scopeUserId ? { userId: scopeUserId } : {}),
      },
      select: {
        userId: true,
        role: true,
        workingHours: true,
        offHoursNoticeEnabled: true,
        user: { select: { name: true } },
      },
    });
    if (members.length === 0) return [];
    const userIds = members.map((m) => m.userId);

    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { aiTimezone: true },
    });
    const tz = org?.aiTimezone || DEFAULT_TIMEZONE;

    const [live, waiting, lastReplies, daily] = await Promise.all([
      this.realtime.listSocketPresence(),
      this.prisma.conversation.groupBy({
        by: ['assignedToId'],
        where: {
          organizationId,
          assignedToId: { in: userIds },
          awaitingHumanReply: true,
          deletedAt: null,
          isArchived: false,
          status: { not: ConversationStatus.CLOSED },
        },
        _count: { _all: true },
      }),
      this.prisma.conversation.groupBy({
        by: ['assignedToId'],
        where: { organizationId, assignedToId: { in: userIds } },
        _max: { lastHumanReplyAt: true },
      }),
      this.prisma.agentPresenceDaily.findMany({
        where: {
          organizationId,
          userId: { in: userIds },
          day: {
            gte: new Date(`${dayKey(range.from, tz)}T00:00:00Z`),
            lte: new Date(`${dayKey(range.to, tz)}T00:00:00Z`),
          },
        },
      }),
    ]);

    const activeByUser = new Map(
      groupPresence(live)
        .filter((p) => p.organizationId === organizationId)
        .map((p) => [p.userId, p.lastActiveAt]),
    );
    const waitingByUser = new Map(waiting.map((w) => [w.assignedToId, w._count._all]));
    const lastReplyByUser = new Map(lastReplies.map((r) => [r.assignedToId, r._max.lastHumanReplyAt]));
    const todayKey = dayKey(now, tz);

    const rows = members.map((m): TeamPresenceRow => {
      const lastActiveAt = activeByUser.get(m.userId) ?? null;
      const days = daily.filter((d) => d.userId === m.userId);
      const today = days.find((d) => d.day.toISOString().slice(0, 10) === todayKey);
      return {
        userId: m.userId,
        name: m.user.name,
        role: m.role,
        status: presenceStatus(lastActiveAt, now),
        lastActiveAt: lastActiveAt?.toISOString() ?? null,
        schedule: this.schedule(
          (m.workingHours ?? null) as BusinessHoursConfig | null,
          m.offHoursNoticeEnabled,
          tz,
          now,
        ),
        waitingCount: waitingByUser.get(m.userId) ?? 0,
        lastHumanReplyAt: lastReplyByUser.get(m.userId)?.toISOString() ?? null,
        today: {
          onlineMinutes: today?.onlineMinutes ?? 0,
          activeMinutes: today?.activeMinutes ?? 0,
          firstSeenAt: today?.firstSeenAt.toISOString() ?? null,
        },
        period: {
          onlineMinutes: days.reduce((sum, d) => sum + d.onlineMinutes, 0),
          activeMinutes: days.reduce((sum, d) => sum + d.activeMinutes, 0),
          daysOnline: days.length,
        },
      };
    });

    return rows.sort(
      (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name, 'pt-BR'),
    );
  }

  private schedule(
    hours: BusinessHoursConfig | null,
    onCallEnabled: boolean,
    tz: string,
    now: Date,
  ): TeamPresenceRow['schedule'] {
    if (!hours) return { configured: false, withinHours: null, returnsAt: null, onCall: false };
    const withinHours = isWithinHours(hours, tz, now);
    const nextOpen = withinHours ? null : nextOpenAt(hours, tz, now);
    return {
      configured: true,
      withinHours,
      returnsAt: nextOpen ? formatReturn(nextOpen, tz, now) : null,
      onCall: onCallEnabled && !withinHours && nextOpen !== null,
    };
  }
}
