import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { WEBHOOK_QUEUE, MAX_WEBHOOK_ATTEMPTS, WEBHOOK_BACKOFF_MS } from './webhooks.constants';
import { mapWebhookData } from './webhook-payload.mapper';

interface DispatchEvent {
  outboxEventId: string;
  organizationId: string;
  trigger: string;
  payload: any;
}

@Injectable()
export class WebhookDispatchService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WEBHOOK_QUEUE) private readonly queue: Queue,
  ) {}

  async dispatch(event: DispatchEvent): Promise<void> {
    const subs = await this.prisma.webhookSubscription.findMany({
      where: { organizationId: event.organizationId, isActive: true, events: { has: event.trigger as any } },
    });
    if (!subs.length) return;

    const data = mapWebhookData(event.trigger, event.payload);
    for (const sub of subs) {
      // Idempotência por (subscription, outbox event): o AutomationEventProcessor
      // chama dispatch() no topo de process() e re-executa em cada retry do BullMQ
      // (ex.: contenção de lock por contato re-lança). Sem esta guarda, cada retry
      // criava uma WebhookDelivery nova e re-disparava o POST (o jobId é liberado
      // após removeOnComplete) → entrega duplicada, ou deixava a linha presa em
      // PENDING quando o dedup do jobId derrubava o re-enqueue.
      const existing = await this.prisma.webhookDelivery.findFirst({
        where: { subscriptionId: sub.id, outboxEventId: event.outboxEventId },
        select: { id: true },
      });
      if (existing) continue;

      const delivery = await this.prisma.webhookDelivery.create({
        data: {
          subscriptionId: sub.id,
          outboxEventId: event.outboxEventId,
          type: event.trigger,
          payload: data,
        },
      });
      await this.queue.add(
        'deliver',
        { deliveryId: delivery.id },
        {
          jobId: `${sub.id}:${event.outboxEventId}`,
          attempts: MAX_WEBHOOK_ATTEMPTS,
          backoff: { type: 'exponential', delay: WEBHOOK_BACKOFF_MS },
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    }
  }
}
