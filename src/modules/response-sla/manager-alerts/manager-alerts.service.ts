import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorSeverity, ErrorSource } from '@prisma/client';
import { ERROR_CODES } from '../../error-reporter/error-codes';
import { ErrorReporterService } from '../../error-reporter/error-reporter.service';
import { parseManagerAlertsConfig, type ManagerAlertsConfig } from './manager-alerts.config';
import { ManagerAlertsRepository, type AlertOrg } from './manager-alerts.repository';
import { isQuietHours, isScoreboardDue, localDateKey, localDayStart } from './manager-alerts.rules';
import {
  buildDigestParams,
  buildScoreboardParams,
  selectOverdueWaits,
  summarizeScoreboard,
} from './manager-alerts.selection';
import { ManagerAlertsSender } from './manager-alerts.sender';
import type { ManagerAlertsThrottle } from './manager-alerts.throttle';
import {
  MANAGER_ALERTS_THROTTLE,
  type ManagerAlertKind,
  type ManagerAlertSendReport,
} from './manager-alerts.types';

interface Target {
  org: AlertOrg;
  config: ManagerAlertsConfig;
}

/**
 * Avisos de SLA de resposta para a gestão por WhatsApp (template HSM):
 * resumo de quem espera há mais de N min úteis e placar diário.
 * O tique do cron nunca lança — falha vira relatório no ErrorReporter.
 */
@Injectable()
export class ManagerAlertsService {
  private readonly logger = new Logger(ManagerAlertsService.name);
  /** Orgs com config inválida já logadas (loga uma vez por processo). */
  private readonly loggedInvalid = new Set<string>();

  constructor(
    private readonly repository: ManagerAlertsRepository,
    private readonly sender: ManagerAlertsSender,
    private readonly errors: ErrorReporterService,
    @Inject(MANAGER_ALERTS_THROTTLE) private readonly throttle: ManagerAlertsThrottle,
  ) {}

  async runTick(now: Date): Promise<void> {
    const orgs = await this.repository.listActiveOrgs();
    for (const org of orgs) {
      const config = this.configFor(org);
      if (!config) continue;
      await this.guarded('resumo', org.id, () => this.tickDigest({ org, config }, now));
      await this.guarded('placar', org.id, () => this.tickScoreboard({ org, config }, now));
    }
  }

  /** Disparo manual: dados reais, sem trava, sem silêncio, mesmo com zero. */
  async sendTest(organizationId: string, kind: ManagerAlertKind, now: Date): Promise<ManagerAlertSendReport> {
    const org = await this.repository.findOrg(organizationId);
    const parsed = parseManagerAlertsConfig(org?.settings);
    if (!org || !parsed.ok) {
      throw new BadRequestException(
        `Avisos de SLA para a gestão não configurados: ${(!parsed.ok && parsed.reason) || 'slaManagerAlerts ausente'}`,
      );
    }
    const target = { org, config: parsed.config };
    return kind === 'digest' ? this.sendDigest(target, now) : this.sendScoreboard(target, now);
  }

  private async tickDigest(target: Target, now: Date): Promise<void> {
    if (isQuietHours(now, target.org.tz)) return;
    const overdue = await this.overdue(target, now);
    if (overdue.length === 0) return;
    if (!(await this.throttle.claimDigest(target.org.id, target.config.digestIntervalMinutes))) return;
    this.reportFailures(target.org.id, await this.deliverDigest(target, overdue));
  }

  private async tickScoreboard(target: Target, now: Date): Promise<void> {
    const { org, config } = target;
    if (!isScoreboardDue(now, org.tz, config.scoreboardMinutes)) return;
    const summary = summarizeScoreboard(await this.dayRows(org, now));
    if (!summary) return;
    if (!(await this.throttle.claimScoreboard(org.id, localDateKey(now, org.tz)))) return;
    this.reportFailures(org.id, await this.deliverScoreboard(target, summary));
  }

  private async sendDigest(target: Target, now: Date): Promise<ManagerAlertSendReport> {
    return this.deliverDigest(target, await this.overdue(target, now));
  }

  private async sendScoreboard(target: Target, now: Date): Promise<ManagerAlertSendReport> {
    return this.deliverScoreboard(target, summarizeScoreboard(await this.dayRows(target.org, now)));
  }

  private async deliverDigest(
    target: Target,
    overdue: Awaited<ReturnType<ManagerAlertsService['overdue']>>,
  ): Promise<ManagerAlertSendReport> {
    const template = target.config.digestTemplate;
    const results = await this.deliver(target, template, (r) => buildDigestParams(r.name, overdue));
    return { kind: 'digest', template, count: overdue.length, results };
  }

  private async deliverScoreboard(
    target: Target,
    summary: ReturnType<typeof summarizeScoreboard>,
  ): Promise<ManagerAlertSendReport> {
    const template = target.config.scoreboardTemplate;
    const results = await this.deliver(target, template, (r) => buildScoreboardParams(r.name, summary));
    return { kind: 'scoreboard', template, count: summary?.overall.total ?? 0, results };
  }

  private async deliver(
    { org, config }: Target,
    templateName: string,
    paramsFor: (r: ManagerAlertsConfig['recipients'][number]) => string[],
  ) {
    const channel = await this.repository.findChannel(org.id, config.channelId);
    if (!channel) {
      const error = `canal ${config.channelId} não encontrado, inativo ou não é WhatsApp oficial nesta org`;
      return config.recipients.map((r) => ({ phone: r.phone, ok: false, error }));
    }
    return this.sender.sendToAll(
      channel,
      config.recipients,
      { name: templateName, language: config.language },
      paramsFor,
    );
  }

  private async overdue({ org, config }: Target, now: Date) {
    const waits = await this.repository.listOpenWaits(org);
    return selectOverdueWaits(waits, org.tz, now, config.digestAfterMinutes);
  }

  private dayRows(org: AlertOrg, now: Date) {
    return this.repository.listCountedWaits(org.id, localDayStart(now, org.tz), now);
  }

  private configFor(org: AlertOrg): ManagerAlertsConfig | null {
    const parsed = parseManagerAlertsConfig(org.settings);
    if (parsed.ok) {
      this.loggedInvalid.delete(org.id);
      return parsed.config;
    }
    if (parsed.reason && !this.loggedInvalid.has(org.id)) {
      this.loggedInvalid.add(org.id);
      this.logger.warn(`sla_gestao_config_invalida org=${org.id}: ${parsed.reason} — recurso desligado`);
    }
    return null;
  }

  private reportFailures(organizationId: string, report: ManagerAlertSendReport): void {
    const failed = report.results.filter((r) => !r.ok);
    if (failed.length === 0) return;
    this.errors.report({
      source: ErrorSource.JOB,
      code: ERROR_CODES.SLA_MANAGER_ALERT_FAILED,
      severity: ErrorSeverity.WARNING,
      message: `Aviso de SLA para a gestão (${report.template}) não chegou a ${failed.length} destinatário(s): ${failed[0].error}`,
      context: { kind: report.kind, failed },
      organizationId,
    });
  }

  private async guarded(step: string, organizationId: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`sla_gestao_${step}_falhou org=${organizationId}: ${msg}`);
      this.errors.report({
        source: ErrorSource.JOB,
        code: ERROR_CODES.SLA_MANAGER_ALERT_FAILED,
        severity: ErrorSeverity.ERROR,
        message: `Aviso de SLA para a gestão (${step}) falhou: ${msg}`,
        stack: err instanceof Error ? err.stack : undefined,
        context: { step },
        organizationId,
      });
    }
  }
}
