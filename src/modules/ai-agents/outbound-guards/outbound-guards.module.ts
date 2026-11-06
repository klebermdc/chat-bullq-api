import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../database/prisma.module';
import { LlmModule } from '../llm/llm.module';
import { FactCheckService } from './fact-check.service';
import { SendCheckRecorder } from './send-check.recorder';

/** Travas de saída do replyToConversation: registro em ai_send_checks e conferência de fato. */
@Module({
  imports: [PrismaModule, LlmModule],
  providers: [SendCheckRecorder, FactCheckService],
  exports: [SendCheckRecorder, FactCheckService],
})
export class OutboundGuardsModule {}
