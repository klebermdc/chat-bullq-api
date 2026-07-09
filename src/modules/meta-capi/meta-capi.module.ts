import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { META_CAPI_QUEUE } from './meta-capi.constants';
import { MetaCapiController } from './meta-capi.controller';
import { MetaCapiService } from './meta-capi.service';
import { MetaCapiHttpClient } from './meta-capi.http-client';
import { MetaCapiQueue } from './meta-capi.queue';
import { MetaCapiProcessor } from './meta-capi.processor';

@Module({
  imports: [BullModule.registerQueue({ name: META_CAPI_QUEUE })],
  controllers: [MetaCapiController],
  providers: [
    MetaCapiService,
    MetaCapiHttpClient,
    MetaCapiQueue,
    MetaCapiProcessor,
  ],
  // MetaCapiQueue é injetado no PipelinesService pra enfileirar no ganho.
  exports: [MetaCapiQueue],
})
export class MetaCapiModule {}
