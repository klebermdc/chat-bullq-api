import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';
import { NotificationProcessor } from './notification.processor';
import { InboundNotifierService } from './inbound-notifier.service';
import { SellerAlertService } from './seller-alert.service';
import { PushModule } from '../push/push.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'notifications' }),
    PushModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsRepository,
    NotificationProcessor,
    InboundNotifierService,
    SellerAlertService,
  ],
  exports: [NotificationsService, InboundNotifierService, SellerAlertService],
})
export class NotificationsModule {}
