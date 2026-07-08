import { Module, forwardRef } from '@nestjs/common';
import { MessageTemplatesController } from './message-templates.controller';
import { MessageTemplatesService } from './message-templates.service';
import { MessageTemplatesRepository } from './message-templates.repository';
import { WhatsAppOfficialModule } from '../adapters/whatsapp-official/whatsapp-official.module';
import { ChannelHubModule } from '../channel-hub.module';

@Module({
  imports: [
    WhatsAppOfficialModule,
    // ChannelsService is provided/exported by ChannelHubModule (there is no
    // standalone ChannelsModule). ChannelHubModule imports this module back,
    // so break the cycle with forwardRef on both sides.
    forwardRef(() => ChannelHubModule),
  ],
  controllers: [MessageTemplatesController],
  providers: [MessageTemplatesService, MessageTemplatesRepository],
  exports: [MessageTemplatesService],
})
export class MessageTemplatesModule {}
