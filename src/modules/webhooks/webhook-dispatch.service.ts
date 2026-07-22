import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { WEBHOOK_QUEUE, MAX_WEBHOOK_ATTEMPTS, WEBHOOK_BACKOFF_MS } from './webhooks.constants';
import { mapWebhookData } from './webhook-payload.mapper';
import { LeadQualifiedPayloadBuilder } from './payloads/lead-qualified.builder';

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
    private readonly leadQualified: LeadQualifiedPayloadBuilder,
  ) {}

  async dispatch(event: DispatchEvent): Promise<void> {
    const subs = await this.prisma.webhookSubscription.findMany({
      where: { organizationId: event.organizationId, isActive: true, events: { has: event.trigger as any } },
    });
    if (!subs.length) return;

    // LEAD_QUALIFIED precisa ir enriquecido (ver o builder). Só montamos
    // depois de saber que existe assinante — evita ida ao banco à toa.
    const data =
      event.trigger === 'LEAD_QUALIFIED'
        ? await this.leadQualified.build(event.payload)
        : mapWebhookData(event.trigger, event.payload);
    for (const sub of subs) {
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
