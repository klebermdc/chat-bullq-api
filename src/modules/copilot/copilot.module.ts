import { Module } from '@nestjs/common';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { LlmModule } from '../ai-agents/llm/llm.module';
import { ToolsModule } from '../ai-agents/tools/tools.module';
import { ConversationAccessModule } from '../messaging/conversations/conversation-access.module';
import { CopilotConsultService } from './consult/copilot-consult.service';

@Module({
  imports: [LlmModule, ToolsModule, ConversationAccessModule],
  controllers: [CopilotController],
  providers: [CopilotService, CopilotConsultService],
})
export class CopilotModule {}
