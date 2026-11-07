import { Injectable } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { ResponseSlaRepository } from './response-sla.repository';
import { pickBreachRecipients } from './response-sla.rules';
import type { SlaContext, SlaRecord } from './response-sla.types';

/**
 * Avisos do SLA de resposta. Vão para o sino (NotificationsService), igual
 * aos demais alertas operacionais; SLA ficou fora do push no celular por
 * decisão de 06/11.
 */
@Injectable()
export class ResponseSlaNotifier {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly repository: ResponseSlaRepository,
  ) {}

  /** Metade da meta: só o dono. Sem dono, ninguém (o estouro avisa todos). */
  async warn(ctx: SlaContext, record: SlaRecord, waitedMinutes: number): Promise<void> {
    if (!ctx.assignedToId) return;
    await this.notifications.notify({
      recipientId: ctx.assignedToId,
      organizationId: ctx.organizationId,
      type: NotificationType.SLA_WARNING,
      title: 'Cliente esperando resposta',
      body: `${ctx.contactName} está esperando há ${waitedMinutes} min.`,
      data: this.payload(ctx, record),
    });
  }

  /** Meta estourada: dono + ADM/Owner online; sem dono, todos os online. */
  async breach(ctx: SlaContext, record: SlaRecord, waitedMinutes: number): Promise<void> {
    const online = await this.repository.listOnlineMembers(ctx.organizationId);
    const recipients = pickBreachRecipients(ctx.assignedToId, online);
    const body =
      `${ctx.contactName} está esperando há ${waitedMinutes} min ` +
      `(meta: ${record.slaMinutes} min no expediente).`;
    for (const recipientId of recipients) {
      await this.notifications.notify({
        recipientId,
        organizationId: ctx.organizationId,
        type: NotificationType.SLA_BREACH,
        title: 'SLA de resposta estourado',
        body,
        data: this.payload(ctx, record),
      });
    }
  }

  private payload(ctx: SlaContext, record: SlaRecord) {
    return {
      conversationId: ctx.conversationId,
      slaType: 'response',
      waitingSince: record.waitingSince.toISOString(),
      dueAt: record.dueAt?.toISOString() ?? null,
    };
  }
}
