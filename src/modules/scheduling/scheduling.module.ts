import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RealtimeModule } from '../realtime/realtime.module';
import { MessagingModule } from '../messaging/messaging.module';
import { SCHEDULED_DISPATCH_QUEUE } from './scheduling.constants';
import { ScheduledMessagesRepository } from './scheduled-messages.repository';
import { ScheduledMessagesService } from './scheduled-messages.service';
import { ScheduledDispatchProcessor } from './scheduled-dispatch.processor';
import { ScheduledMessagesController } from './scheduled-messages.controller';
import { InactivitySettingsRepository } from './inactivity/inactivity-settings.repository';
import { InactivitySettingsService } from './inactivity/inactivity-settings.service';
import { InactivitySettingsController } from './inactivity/inactivity-settings.controller';

@Module({
  imports: [
    BullModule.registerQueue({ name: SCHEDULED_DISPATCH_QUEUE }),
    RealtimeModule,
    forwardRef(() => MessagingModule),
  ],
  controllers: [ScheduledMessagesController, InactivitySettingsController],
  providers: [
    ScheduledMessagesRepository,
    ScheduledMessagesService,
    ScheduledDispatchProcessor,
    InactivitySettingsRepository,
    InactivitySettingsService,
  ],
  exports: [ScheduledMessagesService],
})
export class SchedulingModule {}
