import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RealtimeModule } from '../realtime/realtime.module';
import { MessagingModule } from '../messaging/messaging.module';
import { LlmModule } from '../ai-agents/llm/llm.module';
import {
  SCHEDULED_DISPATCH_QUEUE,
  INACTIVITY_WATCHDOG_QUEUE,
} from './scheduling.constants';
import { ScheduledMessagesRepository } from './scheduled-messages.repository';
import { ScheduledMessagesService } from './scheduled-messages.service';
import { ScheduledDispatchProcessor } from './scheduled-dispatch.processor';
import { ScheduledMessagesController } from './scheduled-messages.controller';
import { InactivitySettingsRepository } from './inactivity/inactivity-settings.repository';
import { InactivitySettingsService } from './inactivity/inactivity-settings.service';
import { InactivitySettingsController } from './inactivity/inactivity-settings.controller';
import { InactivityRepository } from './inactivity/inactivity.repository';
import { ReengageDraftService } from './inactivity/reengage-draft.service';
import { AutoReengageService } from './inactivity/auto-reengage.service';
import { InactivityWatchdogCron } from './inactivity/inactivity-watchdog.cron';
import { InactivityReportService } from './inactivity/inactivity-report.service';
import { InactivityReportController } from './inactivity/inactivity-report.controller';
import { ReengageSuggestionController } from './inactivity/reengage-suggestion.controller';

@Module({
  imports: [
    BullModule.registerQueue({ name: SCHEDULED_DISPATCH_QUEUE }),
    BullModule.registerQueue({ name: INACTIVITY_WATCHDOG_QUEUE }),
    RealtimeModule,
    forwardRef(() => MessagingModule),
    LlmModule,
  ],
  controllers: [
    ScheduledMessagesController,
    InactivitySettingsController,
    InactivityReportController,
    ReengageSuggestionController,
  ],
  providers: [
    ScheduledMessagesRepository,
    ScheduledMessagesService,
    ScheduledDispatchProcessor,
    InactivitySettingsRepository,
    InactivitySettingsService,
    InactivityRepository,
    ReengageDraftService,
    AutoReengageService,
    InactivityWatchdogCron,
    InactivityReportService,
  ],
  exports: [ScheduledMessagesService, ScheduledMessagesRepository],
})
export class SchedulingModule {}
