import { Module } from '@nestjs/common';
import { MessengerInboundAdapter } from './messenger.inbound-adapter';
import { MessengerOutboundAdapter } from './messenger.outbound-adapter';
import { MessengerMessageMapper } from './messenger.message-mapper';
import { MessengerHttpClient } from './messenger.http-client';
import { MessengerContactEnricherService } from './messenger-contact-enricher.service';

@Module({
  providers: [
    MessengerInboundAdapter,
    MessengerOutboundAdapter,
    MessengerMessageMapper,
    MessengerHttpClient,
    MessengerContactEnricherService,
  ],
  exports: [
    MessengerInboundAdapter,
    MessengerOutboundAdapter,
    MessengerHttpClient,
    MessengerContactEnricherService,
  ],
})
export class MessengerModule {}
