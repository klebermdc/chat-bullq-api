import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorSeverity, ErrorSource } from '@prisma/client';
import { ERROR_CODES } from '../error-reporter/error-codes';
import { ErrorReporterService } from '../error-reporter/error-reporter.service';
import { ManagerAlertsRepository, type AlertOrg } from '../response-sla/manager-alerts/manager-alerts.repository';
import { isQuietHours, localDateKey } from '../response-sla/manager-alerts/manager-alerts.rules';
import { formatOfflineAlert, formatQueueAlert, formatSlaAlert, selectOfflineAgents } from './alerts/manager-bot.alerts';
import { parseManagerBotConfig, type ManagerBotConfig, type ManagerChat } from './manager-bot.config';
import { ManagerBotReportsService } from './manager-bot.reports.service';
import { isMonday, isReportDue } from './manager-bot.rules';
import type { ManagerBotThrottle } from './manager-bot.throttle';
import {
  MANAGER_BOT_THROTTLE,
  type BroadcastResult,
  type ManagerReportKind,
} from './manager-bot.types';
import { TelegramClient } from './telegram/telegram.client';

export interface BotTarget {
  org: AlertOrg;
  config: ManagerBotConfig;
}

const MINUTE_MS = 60_000;
/** Chave diária dura mais que um dia: cobre o dia local inteiro com folga. */
const DAILY_KEY_TTL_MS = 36 * 60 * MINUTE_MS;
const QUEUE_ALERT_INTERVAL_MS = 60 * MINUTE_MS;
/** O semanal sai logo depois da abertura, na segunda. */
const WEEKLY_OFFSET_MINUTES = 5;

/**
 * Gerente no Telegram: relatórios em horário fixo e alertas do dia para os
 * chats cadastrados em `settings.managerBot`. O tique nunca lança.
 */
@Injectable()
export class ManagerBotService {
  private readonly logger = new Logger(ManagerBotService.name);
  private readonly loggedInvalid = new Set<string>();

  constructor(
    private readonly orgs: ManagerAlertsRepository,
    private readonly reports: ManagerBotReportsService,
    private readonly telegram: TelegramClient,
    private readonly errors: ErrorReporterService,
    @Inject(MANAGER_BOT_THROTTLE) private readonly throttle: ManagerBotThrottle,
  ) {}

  /** Orgs com o gerente ligado (usado também pelo cadastro). */
  async listTargets(): Promise<BotTarget[]> {
    const orgs = await this.orgs.listActiveOrgs();
    return orgs.flatMap((org) => {
      const config = this.configFor(org);
      return config ? [{ org, config }] : [];
    });
  }

  async runTick(now: Date): Promise<void> {
    if (!this.telegram.isConfigured()) return;
    const targets = (await this.listTargets()).filter((t) => t.config.chats.length > 0);
    for (const target of targets) {
      await this.guarded('abertura', target, () => this.tickOpening(target, now));
      await this.guarded('fechamento', target, () => this.tickClosing(target, now));
      await this.guarded('semanal', target, () => this.tickWeekly(target, now));
      if (isQuietHours(now, target.org.tz)) continue;
      await this.guarded('alerta_sla', target, () => this.tickSla(target, now));
      await this.guarded('alerta_fila', target, () => this.tickQueue(target, now));
      await this.guarded('alerta_offline', target, () => this.tickOffline(target, now));
    }
  }

  /** Disparo manual (endpoint de teste): dados reais, sem trava. */
  async sendReport(organizationId: string, kind: ManagerReportKind, now: Date): Promise<BroadcastResult[]> {
    const target = (await this.listTargets()).find((t) => t.org.id === organizationId);
    if (!target) throw new BadRequestException('Gerente no Telegram não está ligado nesta organização');
    return this.broadcast(target, await this.buildReport(target.org, kind, now));
  }

  buildReport(org: AlertOrg, kind: ManagerReportKind, now: Date, partial = false): Promise<string> {
    if (kind === 'opening') return this.reports.opening(org, now);
    if (kind === 'weekly') return this.reports.weekly(org, now);
    return this.reports.closing(org, now, partial);
  }

  private async tickOpening(target: BotTarget, now: Date): Promise<void> {
    if (!isReportDue(now, target.org.tz, target.config.openingMinutes)) return;
    await this.sendDaily(target, 'abertura', now, () => this.reports.opening(target.org, now));
  }

  private async tickClosing(target: BotTarget, now: Date): Promise<void> {
    if (!isReportDue(now, target.org.tz, target.config.closingMinutes)) return;
    await this.sendDaily(target, 'fechamento', now, () => this.reports.closing(target.org, now, false));
  }

  private async tickWeekly(target: BotTarget, now: Date): Promise<void> {
    const { tz } = target.org;
    if (!isMonday(now, tz) || !isReportDue(now, tz, target.config.openingMinutes + WEEKLY_OFFSET_MINUTES)) return;
    await this.sendDaily(target, 'semanal', now, () => this.reports.weekly(target.org, now));
  }

  private async tickSla({ org, config }: BotTarget, now: Date): Promise<void> {
    const overdue = await this.reports.overdue(org, now, config.slaAlertAfterMinutes);
    const text = formatSlaAlert(overdue, config.slaAlertAfterMinutes);
    if (!text) return;
    if (!(await this.throttle.claim(`sla:${org.id}`, config.alertIntervalMinutes * MINUTE_MS))) return;
    await this.broadcast({ org, config }, text);
  }

  private async tickQueue({ org, config }: BotTarget, now: Date): Promise<void> {
    const queue = await this.reports.queue(org);
    const text = formatQueueAlert(queue.unassigned, queue.oldestSince, config.queueThreshold, now);
    if (!text) return;
    if (!(await this.throttle.claim(`fila:${org.id}`, QUEUE_ALERT_INTERVAL_MS))) return;
    await this.broadcast({ org, config }, text);
  }

  /** Cada vendedor é avisado no máximo uma vez por dia. */
  private async tickOffline({ org, config }: BotTarget, now: Date): Promise<void> {
    const offline = selectOfflineAgents(await this.reports.team(org, now), now, config.offlineMinutes);
    const day = localDateKey(now, org.tz);
    const fresh = [];
    for (const agent of offline) {
      if (await this.throttle.claim(`offline:${org.id}:${agent.userId}:${day}`, DAILY_KEY_TTL_MS)) fresh.push(agent);
    }
    const text = formatOfflineAlert(fresh, now);
    if (text) await this.broadcast({ org, config }, text);
  }

  /** Monta antes de travar: falha na montagem deixa o próximo tique tentar. */
  private async sendDaily(target: BotTarget, name: string, now: Date, build: () => Promise<string>) {
    const text = await build();
    const key = `${name}:${target.org.id}:${localDateKey(now, target.org.tz)}`;
    if (!(await this.throttle.claim(key, DAILY_KEY_TTL_MS))) return;
    await this.broadcast(target, text);
  }

  async broadcast(target: BotTarget, text: string, chats: ManagerChat[] = target.config.chats): Promise<BroadcastResult[]> {
    const results: BroadcastResult[] = [];
    for (const chat of chats) {
      const sent = await this.telegram.sendMessage(chat.chatId, text);
      results.push({ chatId: chat.chatId, ...sent });
    }
    this.reportFailures(target.org.id, results);
    return results;
  }

  private configFor(org: AlertOrg): ManagerBotConfig | null {
    const parsed = parseManagerBotConfig(org.settings);
    if (parsed.ok) {
      this.loggedInvalid.delete(org.id);
      return parsed.config;
    }
    if (parsed.reason && !this.loggedInvalid.has(org.id)) {
      this.loggedInvalid.add(org.id);
      this.logger.warn(`gerente_tg_config_invalida org=${org.id}: ${parsed.reason} — recurso desligado`);
    }
    return null;
  }

  private reportFailures(organizationId: string, results: BroadcastResult[]): void {
    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) return;
    this.errors.report({
      source: ErrorSource.JOB,
      code: ERROR_CODES.MANAGER_BOT_FAILED,
      severity: ErrorSeverity.WARNING,
      message: `Mensagem do gerente no Telegram não chegou a ${failed.length} chat(s): ${failed[0].error}`,
      context: { failed },
      organizationId,
    });
  }

  private async guarded(step: string, target: BotTarget, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`gerente_tg_${step}_falhou org=${target.org.id}: ${msg}`);
      this.errors.report({
        source: ErrorSource.JOB,
        code: ERROR_CODES.MANAGER_BOT_FAILED,
        severity: ErrorSeverity.ERROR,
        message: `Gerente no Telegram (${step}) falhou: ${msg}`,
        stack: err instanceof Error ? err.stack : undefined,
        context: { step },
        organizationId: target.org.id,
      });
    }
  }
}
