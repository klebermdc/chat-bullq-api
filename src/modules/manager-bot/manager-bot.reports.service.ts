import { Injectable } from '@nestjs/common';
import { DailyScoreboardService } from '../dashboard/daily-scoreboard/daily-scoreboard.service';
import { ManagerAlertsRepository, type AlertOrg } from '../response-sla/manager-alerts/manager-alerts.repository';
import { localDateKey, localDayStart } from '../response-sla/manager-alerts/manager-alerts.rules';
import {
  selectOverdueWaits,
  summarizeScoreboard,
  type OverdueWait,
} from '../response-sla/manager-alerts/manager-alerts.selection';
import { TeamPresenceService, type TeamPresenceRow } from '../team-presence/team-presence.service';
import { WhatsappCostsService, type CostsReport } from '../whatsapp-costs/whatsapp-costs.service';
import type { PresenceLine } from './alerts/manager-bot.alerts';
import { ManagerBotRepository } from './manager-bot.repository';
import { previousWeeks, type Range } from './manager-bot.rules';
import { buildClosingReport } from './reports/closing.report';
import {
  buildCostOpeningLines,
  buildCostsCommand,
  buildCostWeeklyLines,
  topChannel,
  type CostsCommandInput,
} from './reports/costs.report';
import { formatDate } from './manager-bot.format';
import { buildOpeningReport } from './reports/opening.report';
import { buildWeeklyReport, type WeekMetrics } from './reports/weekly.report';

const DAY_MS = 24 * 60 * 60_000;

/** Primeiro dia do mês de uma data YYYY-MM-DD. */
export function monthStart(date: string): string {
  return `${date.slice(0, 8)}01`;
}

/** Soma dias a uma data YYYY-MM-DD (aritmética de calendário, sem fuso). */
export function shiftDay(date: string, days: number): string {
  return new Date(new Date(`${date}T12:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

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
    private readonly costsService: WhatsappCostsService,
  ) {}

  async opening(org: AlertOrg, now: Date): Promise<string> {
    const todayStart = localDayStart(now, org.tz);
    const [board, openWaits, team, costLines] = await Promise.all([
      this.scoreboard.getDailyScoreboard(org.id),
      this.waits.listOpenWaits(org),
      this.presence.getTeamPresence(org.id, { from: todayStart, to: now }),
      this.costOpeningLines(org, now),
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
      costLines,
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
    const [lastWeek, beforeWeek, costLines] = await Promise.all([
      this.week(org.id, last),
      this.week(org.id, before),
      this.costWeeklyLines(org, now, last, before),
    ]);
    const text = buildWeeklyReport({
      tz: org.tz,
      last,
      lastMetrics: lastWeek.metrics,
      beforeMetrics: beforeWeek.metrics,
      ranking: lastWeek.ranking,
    });
    return [text, ...costLines].join('\n');
  }

  /** /custos: hoje, mês, projeção e quem gera o custo no canal mais caro. */
  async costs(org: AlertOrg, now: Date): Promise<string> {
    const today = localDateKey(now, org.tz);
    const [todayReport, month] = await Promise.all([
      this.costsService.getCosts(org.id, now, today, today),
      this.costsService.getCosts(org.id, now, monthStart(today), today),
    ]);
    const input: CostsCommandInput = {
      todayLabel: formatDate(now, org.tz),
      today,
      todayReport,
      month,
      top: await this.topBreakdown(org, now, month),
    };
    return buildCostsCommand(input);
  }

  todayCosts(org: AlertOrg, now: Date): Promise<CostsReport> {
    const today = localDateKey(now, org.tz);
    return this.costsService.getCosts(org.id, now, today, today);
  }

  /** Para o assistente: período em dias locais (YYYY-MM-DD). */
  async costSummary(org: AlertOrg, now: Date, from: string, to: string) {
    const report = await this.costsService.getCosts(org.id, now, from, to);
    return { report, top: await this.topBreakdown(org, now, report) };
  }

  /** A abertura sai mesmo se a Meta falhar. */
  private async costOpeningLines(org: AlertOrg, now: Date): Promise<string[]> {
    try {
      const today = localDateKey(now, org.tz);
      const yesterday = shiftDay(today, -1);
      const [y, m] = await Promise.all([
        this.costsService.getCosts(org.id, now, yesterday, yesterday),
        this.costsService.getCosts(org.id, now, monthStart(yesterday), yesterday),
      ]);
      return buildCostOpeningLines(y, m);
    } catch {
      return ['<b>WhatsApp:</b> custo indisponível agora'];
    }
  }

  private async costWeeklyLines(org: AlertOrg, now: Date, last: Range, before: Range): Promise<string[]> {
    try {
      const days = (r: Range) => [localDateKey(r.from, org.tz), shiftDay(localDateKey(r.to, org.tz), -1)] as const;
      const [l, b] = await Promise.all([
        this.costsService.getCosts(org.id, now, ...days(last)),
        this.costsService.getCosts(org.id, now, ...days(before)),
      ]);
      return buildCostWeeklyLines(l, b, await this.topBreakdown(org, now, l));
    } catch {
      return ['', '<b>Custo do WhatsApp:</b> indisponível agora'];
    }
  }

  private async topBreakdown(org: AlertOrg, now: Date, report: CostsReport) {
    const channel = topChannel(report);
    if (!channel) return null;
    const detail = await this.costsService.getBreakdown(org.id, channel.channelId, now, report.from, report.to);
    return { channel, senders: detail.senders, templates: detail.templates };
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
