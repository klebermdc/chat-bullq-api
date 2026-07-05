import { Module } from '@nestjs/common';
import { AiProviderKeysController } from './ai-provider-keys.controller';
import { AiProviderKeysService } from './ai-provider-keys.service';

@Module({
  controllers: [AiProviderKeysController],
  providers: [AiProviderKeysService],
  exports: [AiProviderKeysService],
})
export class AiProviderKeysModule {}
