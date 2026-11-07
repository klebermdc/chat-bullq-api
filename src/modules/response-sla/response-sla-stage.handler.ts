import { Injectable } from '@nestjs/common';
import { isWithinHours, nextOpenAt } from '../routing/availability/business-hours.util';
import { businessMinutesBetween } from '../routing/availability/business-minutes.util';
import { ResponseSlaNotifier } from './response-sla.notifier';
import { ResponseSlaRepository } from './response-sla.repository';
import { ResponseSlaScheduler } from './response-sla.scheduler';
import { ResponseSlaService } from './response-sla.service';
import { planStages } from './response-sla.rules';
import type { SlaContext, SlaRecord, StageJobData } from './response-sla.types';

/** Folga para job que dispara um pouco antes do alvo. */
const EARLY_TOLERANCE_MS = 5_000;
const RECONCILE_BATCH = 200;

export type StageOutcome =
  | 'notified'
  | 'rescheduled'
  | 'deferred'
  | 'skip:closed'
  | 'skip:stale'
  | 'skip:already_done'
  | 'skip:not_waiting'
  | 'skip:sla_disabled'
  | 'skip:no_hours';

/**
 * Executa um job de aviso/estouro. Sempre relê a conversa: o job pode estar
 * velho (respondida, dono trocado, SLA desligado) e aí vira no-op ou é
 * reagendado. Avisos nunca saem fora do expediente que vale para a conversa.
 */
@Injectable()
export class ResponseSlaStageHandler {
  constructor(
    private readonly repository: ResponseSlaRepository,
    private readonly scheduler: ResponseSlaScheduler,
    private readonly notifier: ResponseSlaNotifier,
    private readonly sla: ResponseSlaService,
  ) {}

  async handle(data: StageJobData, now: Date): Promise<StageOutcome> {
    const record = await this.repository.findRecord(data.recordId);
    if (!record || record.respondedAt || record.endedAt) return 'skip:closed';
    if (record.waitingSince.getTime() !== data.waitingSince) return 'skip:stale';
    if (record.breached || (data.stage === 'warn' && record.warnedAt)) {
      return 'skip:already_done';
    }

    const ctx = await this.repository.loadContext(record.conversationId);
    if (!ctx || !ctx.isWaiting) {
      await this.repository.closeEnded(record.id, 'not_waiting', now);
      return 'skip:not_waiting';
    }
    if (ctx.slaMinutes === null) {
      await this.repository.closeEnded(record.id, 'sla_disabled', now);
      return 'skip:sla_disabled';
    }
    return this.fireOrReschedule(data, record, ctx, now);
  }

  /** Esperas abertas cuja conversa saiu do Esperando sem passar por um gancho. */
  async reconcile(now: Date): Promise<number> {
    const stale = await this.repository.findStaleOpenRecords(RECONCILE_BATCH);
    for (const row of stale) {
      const answered = row.lastHumanReplyAt && row.lastHumanReplyAt >= row.waitingSince;
      if (answered) {
        await this.sla.onHumanReply(row.conversationId, row.lastHumanReplyAt!);
      } else {
        await this.repository.closeEnded(row.id, 'reconcile', now);
      }
    }
    return stale.length;
  }

  private async fireOrReschedule(
    data: StageJobData,
    record: SlaRecord,
    ctx: SlaContext,
    now: Date,
  ): Promise<StageOutcome> {
    const plan = planStages(ctx.hours, ctx.tz, record.waitingSince, record.slaMinutes);
    const target = data.stage === 'warn' ? plan.warnAt : plan.dueAt;
    if (!target) return 'skip:no_hours';

    // Dono trocou para alguém cujo prazo é mais tarde: o alvo andou.
    if (target.getTime() - now.getTime() > EARLY_TOLERANCE_MS) {
      await this.repository.updatePlan(record.id, { agentId: ctx.assignedToId, dueAt: plan.dueAt });
      await this.scheduler.schedule(record, data.stage, target, now);
      return 'rescheduled';
    }

    // Job atrasado (fila parada) que caiu fora do expediente: espera abrir.
    if (!isWithinHours(ctx.hours, ctx.tz, now)) {
      const opensAt = nextOpenAt(ctx.hours, ctx.tz, now);
      if (!opensAt) return 'skip:no_hours';
      await this.scheduler.schedule(record, data.stage, opensAt, now);
      return 'deferred';
    }

    const waited = Math.round(businessMinutesBetween(ctx.hours, ctx.tz, record.waitingSince, now));
    if (data.stage === 'warn') {
      if (!(await this.repository.claimWarn(record.id, now))) return 'skip:already_done';
      await this.notifier.warn(ctx, record, waited);
      return 'notified';
    }
    if (!(await this.repository.claimBreach(record.id, now))) return 'skip:already_done';
    await this.notifier.breach(ctx, record, waited);
    return 'notified';
  }
}
