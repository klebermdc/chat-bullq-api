import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AgendaModule } from '../agenda/agenda.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { VoiceAuthGuard } from './voice-auth.guard';
import { VoiceToolsController } from './voice-tools.controller';
import { VoiceToolsService } from './voice-tools.service';

@Module({
  imports: [AgendaModule, RealtimeModule, BullModule.registerQueue({ name: 'outbound-messages' })],
  controllers: [VoiceToolsController],
  providers: [VoiceToolsService, VoiceAuthGuard],
})
export class VoiceModule {}
