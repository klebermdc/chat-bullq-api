import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AgendaModule } from '../agenda/agenda.module';
import { SimulatedModule } from '../mystery-shopper/simulated/simulated.module';
import { CallsModule } from '../calls/calls.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CallingGraphClient } from './outreach/calling-graph.client';
import { LiveKitDialer } from './outreach/livekit-dialer';
import { VOICE_OUTREACH_QUEUE } from './outreach/outreach.constants';
import { OutreachCron, OutreachProcessor } from './outreach/outreach.cron';
import { OutreachService } from './outreach/outreach.service';
import { VoiceAuthGuard } from './voice-auth.guard';
import { VoiceSettingsController } from './voice-settings.controller';
import { SellerCallsController } from './seller-calls.controller';
import { SellerCallsService } from './seller-calls.service';
import { SellerCallRecordService } from './seller-call-record.service';
import { VoiceToolsController } from './voice-tools.controller';
import { VoiceToolsService } from './voice-tools.service';

@Module({
  imports: [AgendaModule, SimulatedModule, CallsModule, RealtimeModule, BullModule.registerQueue({ name: 'outbound-messages' }, { name: VOICE_OUTREACH_QUEUE })],
  controllers: [VoiceToolsController, VoiceSettingsController, SellerCallsController],
  providers: [VoiceToolsService, VoiceAuthGuard, CallingGraphClient, LiveKitDialer, OutreachService, OutreachCron, OutreachProcessor, SellerCallsService, SellerCallRecordService],
})
export class VoiceModule {}
