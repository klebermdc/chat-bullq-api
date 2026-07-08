import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RealtimeModule } from '../realtime/realtime.module';
import { MessagingModule } from '../messaging/messaging.module';
import { SCHEDULED_DISPATCH_QUEUE } from './scheduling.constants';
import { ScheduledMessagesRepository } from './scheduled-messages.repository';
import { ScheduledMessagesService } from './scheduled-messages.service';
import { ScheduledDispatchProcessor } from './scheduled-dispatch.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: SCHEDULED_DISPATCH_QUEUE }),
    RealtimeModule,
    MessagingModule,
  ],
  controllers: [],
  providers: [
    ScheduledMessagesRepository,
    ScheduledMessagesService,
    ScheduledDispatchProcessor,
  ],
  exports: [ScheduledMessagesService],
})
export class SchedulingModule {}
