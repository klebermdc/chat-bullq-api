import { Module, forwardRef } from '@nestjs/common';
import { WhatsAppOfficialInboundAdapter } from './whatsapp-official.inbound-adapter';
import { WhatsAppOfficialOutboundAdapter } from './whatsapp-official.outbound-adapter';
import { WhatsAppOfficialMessageMapper } from './whatsapp-official.message-mapper';
import { WhatsAppOfficialHttpClient } from './whatsapp-official.http-client';
import { WhatsAppPlatformConfigService } from './whatsapp-platform-config.service';
import { MessagingModule } from '../../../messaging/messaging.module';

@Module({
  imports: [forwardRef(() => MessagingModule)],
  providers: [
    WhatsAppOfficialInboundAdapter,
    WhatsAppOfficialOutboundAdapter,
    WhatsAppOfficialMessageMapper,
    WhatsAppOfficialHttpClient,
    WhatsAppPlatformConfigService,
  ],
  exports: [
    WhatsAppOfficialInboundAdapter,
    WhatsAppOfficialOutboundAdapter,
    WhatsAppOfficialHttpClient,
    WhatsAppPlatformConfigService,
  ],
})
export class WhatsAppOfficialModule {}
