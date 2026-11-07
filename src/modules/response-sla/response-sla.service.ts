import { Injectable, Logger } from '@nestjs/common';
import { businessMinutesBetween } from '../routing/availability/business-minutes.util';
import { ResponseSlaRepository } from './response-sla.repository';
import { ResponseSlaScheduler } from './response-sla.scheduler';
import { planStages } from './response-sla.rules';
import type { EndReason } from './response-sla.types';

/**
 * Ganchos do SLA de resposta em horário útil. Chamados pelos pontos que
 * mexem em `conversations.awaiting_human_reply`, no dono ou no status.
 *
 * Todos os métodos públicos engolem erro (só logam): o SLA é medição e
 * alerta, nunca pode derrubar o recebimento ou o envio de mensagem.
 */
@Injectable()
export class ResponseSlaService {
  private readonly logger = new Logger(ResponseSlaService.name);

  constructor(
    private readonly repository: ResponseSlaRepository,
    private readonly scheduler: ResponseSlaScheduler,
  ) {}

  /**
   * Cliente ficou esperando humano (flag ligou). Abre a espera se ainda não
   * houver uma aberta — mensagens seguidas não reiniciam o relógio.
   * `isAiInCharge` só é consultado quando tudo o mais permite abrir.
   */
  async onCustomerWaiting(
    conversationId: string,
    at: Date,
    isAiInCharge?: () => Promise<boolean>,
  ): Promise<void> {
    await this.safely('onCustomerWaiting', conversationId, () =>
      this.startWait(conversationId, at, isAiInCharge),
    );
  }

  /** Humano respondeu: fecha a espera com os minutos úteis gastos. */
  async onHumanReply(conversationId: string, at: Date): Promise<void> {
    await this.safely('onHumanReply', conversationId, async () => {
      const record = await this.repository.findOpenRecord(conversationId);
      if (!record) return;
      const ctx = await this.repository.loadContext(conversationId);
      if (!ctx) return;
      const minutes = businessMinutesBetween(ctx.hours, ctx.tz, record.waitingSince, at);
      await this.repository.closeAnswered(record.id, {
        respondedAt: at,
        businessMinutes: Math.round(minutes),
        breached: record.breached || minutes > record.slaMinutes,
        agentId: ctx.assignedToId ?? record.agentId,
      });
    });
  }

  /** Espera acabou sem resposta (finalizada, arquivada, retirada do Esperando). */
  async onWaitEnded(conversationId: string, reason: EndReason, at: Date): Promise<void> {
    await this.safely('onWaitEnded', conversationId, async () => {
      const record = await this.repository.findOpenRecord(conversationId);
      if (record) await this.repository.closeEnded(record.id, reason, at);
    });
  }

  /**
   * Dono mudou. Com espera aberta: recalcula o prazo desde o INÍCIO da
   * espera com o horário do novo dono. Sem espera e no Esperando: um humano
   * passou a responder pela conversa — o relógio começa agora.
   */
  async onOwnerChanged(conversationId: string, at: Date): Promise<void> {
    await this.safely('onOwnerChanged', conversationId, async () => {
      const record = await this.repository.findOpenRecord(conversationId);
      if (!record) return this.startWait(conversationId, at);

      const ctx = await this.repository.loadContext(conversationId);
      if (!ctx || ctx.slaMinutes === null) return;
      const plan = planStages(ctx.hours, ctx.tz, record.waitingSince, record.slaMinutes);
      await this.repository.updatePlan(record.id, {
        agentId: ctx.assignedToId,
        dueAt: plan.dueAt,
      });
      await this.scheduler.scheduleOpenStages(record, plan, at);
    });
  }

  private async startWait(
    conversationId: string,
    at: Date,
    isAiInCharge?: () => Promise<boolean>,
  ): Promise<void> {
    const ctx = await this.repository.loadContext(conversationId);
    if (!ctx || ctx.slaMinutes === null || !ctx.isWaiting) return;
    if (await this.repository.findOpenRecord(conversationId)) return;
    if (isAiInCharge && (await isAiInCharge())) return;

    const plan = planStages(ctx.hours, ctx.tz, at, ctx.slaMinutes);
    const record = await this.repository.createRecord({
      organizationId: ctx.organizationId,
      conversationId,
      agentId: ctx.assignedToId,
      slaMinutes: ctx.slaMinutes,
      waitingSince: at,
      dueAt: plan.dueAt,
    });
    if (!record) return;
    await this.scheduler.scheduleOpenStages(record, plan, at);
  }

  private async safely(
    hook: string,
    conversationId: string,
    run: () => Promise<void>,
  ): Promise<void> {
    try {
      await run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`sla_resposta_${hook}_falhou conv=${conversationId}: ${msg}`);
    }
  }
}
