import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LlmService } from './llm.service';
import { AiProviderKeysModule } from '../../ai-provider-keys/ai-provider-keys.module';

@Module({
  imports: [ConfigModule, AiProviderKeysModule],
  providers: [LlmService],
  exports: [LlmService],
})
export class LlmModule {}
