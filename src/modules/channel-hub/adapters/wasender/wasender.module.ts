import { Module } from '@nestjs/common';
import { WasenderInboundAdapter } from './wasender.inbound-adapter';
import { WasenderOutboundAdapter } from './wasender.outbound-adapter';
import { WasenderMessageMapper } from './wasender.message-mapper';
import { WasenderHttpClient } from './wasender.http-client';

@Module({
  providers: [
    WasenderInboundAdapter,
    WasenderOutboundAdapter,
    WasenderMessageMapper,
    WasenderHttpClient,
  ],
  exports: [
    WasenderInboundAdapter,
    WasenderOutboundAdapter,
    WasenderHttpClient,
  ],
})
export class WasenderModule {}
