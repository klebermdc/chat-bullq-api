import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RealtimeModule } from '../realtime/realtime.module';
import { SCHEDULED_DISPATCH_QUEUE } from './scheduling.constants';
import { ScheduledMessagesRepository } from './scheduled-messages.repository';
import { ScheduledMessagesService } from './scheduled-messages.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: SCHEDULED_DISPATCH_QUEUE }),
    RealtimeModule,
  ],
  controllers: [],
  providers: [ScheduledMessagesRepository, ScheduledMessagesService],
  exports: [ScheduledMessagesService],
})
export class SchedulingModule {}
