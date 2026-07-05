import { Module } from '@nestjs/common';
import { AiProviderKeysController } from './ai-provider-keys.controller';
import { AiProviderKeysService } from './ai-provider-keys.service';
import { ProviderKeyResolverService } from './provider-key-resolver.service';

@Module({
  controllers: [AiProviderKeysController],
  providers: [AiProviderKeysService, ProviderKeyResolverService],
  exports: [AiProviderKeysService, ProviderKeyResolverService],
})
export class AiProviderKeysModule {}
