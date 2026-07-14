import { Module } from '@nestjs/common';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { LlmModule } from '../ai-agents/llm/llm.module';
import { ToolsModule } from '../ai-agents/tools/tools.module';

@Module({
  imports: [LlmModule, ToolsModule],
  controllers: [CopilotController],
  providers: [CopilotService],
})
export class CopilotModule {}
