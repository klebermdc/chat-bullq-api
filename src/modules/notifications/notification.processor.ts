import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { NotificationType } from '@prisma/client';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { PushDispatchService } from '../push/push-dispatch.service';
import { PushIntent } from '../push/push.types';

@Processor('notifications', { concurrency: 10 })
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly realtimeGateway: RealtimeGateway,
    private readonly push: PushDispatchService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    const { notificationId, recipientId, organizationId, type, title, body, data } = job.data;

    this.realtimeGateway.emitToUser(recipientId, 'notification:new', {
      id: notificationId,
      recipientId,
      type,
      title,
      body,
      data,
      createdAt: new Date().toISOString(),
    });

    this.logger.log(`Notification delivered via WS: ${notificationId} to user:${recipientId}`);

    const pushOutcome = await this.deliverPush(job.data.push, recipientId, organizationId, type);
    const channels = pushOutcome === 'sent' ? ['in-app', 'web-push'] : ['in-app'];
    return { delivered: true, channels, push: pushOutcome };
  }

  /**
   * Best-effort: push quebrado não pode reprocessar o job (o aviso in-app já
   * saiu e sairia de novo). Sem `push` no job, o aviso fica só no app.
   */
  private async deliverPush(
    intent: PushIntent | undefined,
    recipientId: string,
    organizationId: string,
    type: NotificationType,
  ): Promise<string> {
    if (!intent) return 'not_requested';
    try {
      return await this.push.dispatch({ recipientId, organizationId, type, intent });
    } catch (err: any) {
      this.logger.warn(`web push falhou (não crítico) user=${recipientId}: ${err?.message ?? err}`);
      return 'error';
    }
  }
}
