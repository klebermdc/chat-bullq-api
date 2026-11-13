import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SimulatedModule } from '../mystery-shopper/simulated/simulated.module';
import { PrismaModule } from '../../database/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WEBHOOK_QUEUE } from './webhooks.constants';
import { WebhookSubscriptionsService } from './webhook-subscriptions.service';
import { LeadQualifiedPayloadBuilder } from './payloads/lead-qualified.builder';
import { WebhookDispatchService } from './webhook-dispatch.service';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';
import { WebhooksController } from './webhooks.controller';

@Module({
  imports: [
    PrismaModule,
    SimulatedModule,
    NotificationsModule,
    BullModule.registerQueue({ name: WEBHOOK_QUEUE }),
  ],
  controllers: [WebhooksController],
  providers: [WebhookSubscriptionsService, WebhookDispatchService,
    LeadQualifiedPayloadBuilder, WebhookDeliveryProcessor],
  exports: [WebhookSubscriptionsService, WebhookDispatchService],
})
export class WebhooksModule {}
