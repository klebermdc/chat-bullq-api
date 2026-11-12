import { Injectable } from '@nestjs/common';
import { DailyScoreboardService } from '../dashboard/daily-scoreboard/daily-scoreboard.service';
import { ManagerAlertsRepository, type AlertOrg } from '../response-sla/manager-alerts/manager-alerts.repository';
import { localDayStart } from '../response-sla/manager-alerts/manager-alerts.rules';
import {
  selectOverdueWaits,
  summarizeScoreboard,
  type OverdueWait,
} from '../response-sla/manager-alerts/manager-alerts.selection';
import { TeamPresenceService, type TeamPresenceRow } from '../team-presence/team-presence.service';
import type { PresenceLine } from './alerts/manager-bot.alerts';
import { ManagerBotRepository } from './manager-bot.repository';
import { previousWeeks, type Range } from './manager-bot.rules';
import { buildClosingReport } from './reports/closing.report';
import { buildOpeningReport } from './reports/opening.report';
import { buildWeeklyReport, type WeekMetrics } from './reports/weekly.report';

/**
 * Junta os números de cada relatório a partir dos serviços que já existem
 * (placar do Hub, SLA, presença), para baterem com o painel.
 */
@Injectable()
export class ManagerBotReportsService {
  constructor(
    private readonly scoreboard: DailyScoreboardService,
    private readonly waits: ManagerAlertsRepository,
    private readonly presence: TeamPresenceService,
    private readonly repository: ManagerBotRepository,
  ) {}

  async opening(org: AlertOrg, now: Date): Promise<string> {
    const todayStart = localDayStart(now, org.tz);
    const [board, openWaits, team] = await Promise.all([
      this.scoreboard.getDailyScoreboard(org.id),
      this.waits.listOpenWaits(org),
      this.presence.getTeamPresence(org.id, { from: todayStart, to: now }),
    ]);
    return buildOpeningReport({
      now,
      tz: org.tz,
      queue: board.queue,
      waitingSinceYesterday: openWaits.filter((w) => w.waitingSince < todayStart),
      team: team.map((t) => ({
        name: t.name,
        configured: t.schedule.configured,
        withinHours: t.schedule.withinHours,
        returnsAt: t.schedule.returnsAt,
      })),
    });
  }

  async closing(org: AlertOrg, now: Date, partial: boolean): Promise<string> {
    const today = { from: localDayStart(now, org.tz), to: now };
    const [board, slaRows, lost] = await Promise.all([
      this.scoreboard.getDailyScoreboard(org.id),
      this.waits.listCountedWaits(org.id, today.from, today.to),
      this.repository.lostByReason(org.id, today),
    ]);
    return buildClosingReport({ now, tz: org.tz, partial, scoreboard: board, sla: summarizeScoreboard(slaRows), lost });
  }

  async weekly(org: AlertOrg, now: Date): Promise<string> {
    const { last, before } = previousWeeks(now, org.tz);
    const [lastWeek, beforeWeek] = await Promise.all([this.week(org.id, last), this.week(org.id, before)]);
    return buildWeeklyReport({
      tz: org.tz,
      last,
      lastMetrics: lastWeek.metrics,
      beforeMetrics: beforeWeek.metrics,
      ranking: lastWeek.ranking,
    });
  }

  async overdue(org: AlertOrg, now: Date, afterMinutes: number): Promise<OverdueWait[]> {
    return selectOverdueWaits(await this.waits.listOpenWaits(org), org.tz, now, afterMinutes);
  }

  async queue(org: AlertOrg): Promise<{ unassigned: number; oldestSince: string | null }> {
    return (await this.scoreboard.getDailyScoreboard(org.id)).queue;
  }

  async team(org: AlertOrg, now: Date): Promise<PresenceLine[]> {
    return this.teamDetail(org, now);
  }

  teamDetail(org: AlertOrg, now: Date): Promise<TeamPresenceRow[]> {
    return this.presence.getTeamPresence(org.id, { from: localDayStart(now, org.tz), to: now });
  }

  private async week(organizationId: string, range: Range) {
    const [entered, closed, lost, slaRows] = await Promise.all([
      this.repository.countEntered(organizationId, range),
      this.repository.countClosed(organizationId, range),
      this.repository.lostByReason(organizationId, range),
      this.waits.listCountedWaits(organizationId, range.from, range.to),
    ]);
    const sla = summarizeScoreboard(slaRows);
    const metrics: WeekMetrics = {
      entered,
      closed,
      lost: lost.reduce((sum, l) => sum + l.count, 0),
      slaPercent: sla ? (sla.overall.within / sla.overall.total) * 100 : null,
    };
    return { metrics, ranking: sla?.agents ?? [] };
  }
}
