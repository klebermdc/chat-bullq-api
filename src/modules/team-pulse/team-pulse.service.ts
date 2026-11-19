import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ErrorSeverity, ErrorSource } from '@prisma/client';
import { ERROR_CODES } from '../error-reporter/error-codes';
import { ErrorReporterService } from '../error-reporter/error-reporter.service';
import { ManagerAlertsRepository, type AlertOrg } from '../response-sla/manager-alerts/manager-alerts.repository';
import { localDateKey, localDayStart } from '../response-sla/manager-alerts/manager-alerts.rules';
import { ManagerAlertsSender, type RecipientResult } from '../response-sla/manager-alerts/manager-alerts.sender';
import { TeamPresenceService, type TeamPresenceRow } from '../team-presence/team-presence.service';
import { parseTeamPulseConfig, type TeamPulseConfig } from './team-pulse.config';
import { buildClosingParams, buildHourlyParams } from './team-pulse.params';
import { TeamPulseRepository, type Range } from './team-pulse.repository';
import { decidePulse, localHour, withinHoursMembers, type PulseKind } from './team-pulse.rules';
import type { TeamPulseThrottle } from './team-pulse.throttle';
import { TEAM_PULSE_THROTTLE, type TeamPulseSendReport } from './team-pulse.types';

interface Target {
  org: AlertOrg;
  config: TeamPulseConfig;
}

const HOUR_MS = 60 * 60_000;

/**
 * Pulso do atendimento por WhatsApp (template HSM) para a gestão: de hora em
 * hora enquanto alguém está no próprio horário, e o fechamento com o ponto do
 * dia na `closingHour`. O tique nunca lança — falha vira ErrorReporter.
 */
@Injectable()
export class TeamPulseService {
  private readonly logger = new Logger(TeamPulseService.name);
  /** Orgs com config inválida já logadas (loga uma vez por processo). */
  private readonly loggedInvalid = new Set<string>();

  constructor(
    private readonly alerts: ManagerAlertsRepository,
    private readonly repository: TeamPulseRepository,
    private readonly presence: TeamPresenceService,
    private readonly sender: ManagerAlertsSender,
    private readonly errors: ErrorReporterService,
    @Inject(TEAM_PULSE_THROTTLE) private readonly throttle: TeamPulseThrottle,
  ) {}

  async runTick(now: Date): Promise<void> {
    const orgs = await this.alerts.listActiveOrgs();
    for (const org of orgs) {
      const config = this.configFor(org);
      if (!config) continue;
      await this.guarded(org.id, () => this.tickOrg({ org, config }, now));
    }
  }

  /** Disparo manual: dados reais agora, sem olhar a hora nem a trava. */
  async sendTest(organizationId: string, kind: PulseKind, now: Date): Promise<TeamPulseSendReport> {
    const org = await this.alerts.findOrg(organizationId);
    const parsed = parseTeamPulseConfig(org?.settings);
    if (!org || !parsed.ok) {
      const reason = (!parsed.ok && parsed.reason) || 'teamPulse ausente';
      throw new BadRequestException(`Pulso do atendimento não configurado: ${reason}`);
    }
    const target = { org, config: parsed.config };
    const team = await this.team(org, now);
    return kind === 'hourly' ? this.sendHourly(target, team, now) : this.sendClosing(target, team, now);
  }

  private async tickOrg(target: Target, now: Date): Promise<void> {
    const { org, config } = target;
    const hour = localHour(now, org.tz);
    if (hour > config.closingHour) return;
    const team = await this.team(org, now);
    const kind = decidePulse({
      hour,
      closingHour: config.closingHour,
      anyoneWithinHours: withinHoursMembers(team).length > 0,
    });
    if (!kind) return;
    if (!(await this.throttle.claimHour(org.id, localDateKey(now, org.tz), hour))) return;
    const report =
      kind === 'hourly' ? await this.sendHourly(target, team, now) : await this.sendClosing(target, team, now);
    this.reportFailures(org.id, report);
  }

  private async sendHourly(target: Target, team: TeamPresenceRow[], now: Date): Promise<TeamPulseSendReport> {
    const { org } = target;
    const lastHour: Range = { from: new Date(now.getTime() - HOUR_MS), to: now };
    const [waits, breaches, leads] = await Promise.all([
      this.alerts.listOpenWaits(org),
      this.repository.listBreaches(org.id, lastHour),
      this.repository.countLeads(org.id, lastHour),
    ]);
    const params = buildHourlyParams({
      now,
      tz: org.tz,
      members: withinHoursMembers(team),
      waits,
      breaches,
      leads,
    });
    return this.deliver(target, 'hourly', params);
  }

  private async sendClosing(target: Target, team: TeamPresenceRow[], now: Date): Promise<TeamPulseSendReport> {
    const { org } = target;
    const today: Range = { from: localDayStart(now, org.tz), to: now };
    const todayKey = localDateKey(now, org.tz);
    const [waits, breaches, leads] = await Promise.all([
      this.alerts.listOpenWaits(org),
      this.repository.listBreaches(org.id, today),
      this.repository.countLeads(org.id, today),
    ]);
    // Só atendentes com horário de trabalho (fica de fora quem só olha o painel).
    const days = team.filter((m) => m.schedule.configured).map((m) => ({ name: m.name, day: m.period.days.find((d) => d.day === todayKey) ?? null }));
    const params = buildClosingParams({ now, tz: org.tz, days, waits, breaches, leads });
    return this.deliver(target, 'closing', params);
  }

  private async deliver(
    { org, config }: Target,
    kind: PulseKind,
    params: string[],
  ): Promise<TeamPulseSendReport> {
    const template = kind === 'hourly' ? config.hourlyTemplate : config.closingTemplate;
    const channel = await this.alerts.findChannel(org.id, config.channelId);
    if (!channel) {
      const error = `canal ${config.channelId} não encontrado, inativo ou não é WhatsApp oficial nesta org`;
      const results: RecipientResult[] = config.recipients.map((r) => ({ phone: r.phone, ok: false, error }));
      return { kind, template, results };
    }
    const results = await this.sender.sendToAll(
      channel,
      config.recipients,
      { name: template, language: config.language },
      () => params,
    );
    return { kind, template, results };
  }

  /** Presença do dia (ponto de hoje + status agora + horário de cada um). */
  private team(org: AlertOrg, now: Date): Promise<TeamPresenceRow[]> {
    return this.presence.getTeamPresence(org.id, { from: localDayStart(now, org.tz), to: now });
  }

  private configFor(org: AlertOrg): TeamPulseConfig | null {
    const parsed = parseTeamPulseConfig(org.settings);
    if (parsed.ok) {
      this.loggedInvalid.delete(org.id);
      return parsed.config;
    }
    if (parsed.reason && !this.loggedInvalid.has(org.id)) {
      this.loggedInvalid.add(org.id);
      this.logger.warn(`pulso_equipe_config_invalida org=${org.id}: ${parsed.reason} — recurso desligado`);
    }
    return null;
  }

  private reportFailures(organizationId: string, report: TeamPulseSendReport): void {
    const failed = report.results.filter((r) => !r.ok);
    if (failed.length === 0) return;
    this.logger.warn(`pulso_equipe_envio_falhou org=${organizationId} template=${report.template}: ${failed[0].error}`);
    this.errors.report({
      source: ErrorSource.JOB,
      code: ERROR_CODES.TEAM_PULSE_FAILED,
      severity: ErrorSeverity.WARNING,
      message: `Pulso do atendimento (${report.template}) não chegou a ${failed.length} destinatário(s): ${failed[0].error}`,
      context: { kind: report.kind, failed },
      organizationId,
    });
  }

  private async guarded(organizationId: string, run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`pulso_equipe_falhou org=${organizationId}: ${msg}`);
      this.errors.report({
        source: ErrorSource.JOB,
        code: ERROR_CODES.TEAM_PULSE_FAILED,
        severity: ErrorSeverity.ERROR,
        message: `Pulso do atendimento falhou: ${msg}`,
        stack: err instanceof Error ? err.stack : undefined,
        organizationId,
      });
    }
  }
}
