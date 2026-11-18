import { forwardRef, Module } from '@nestjs/common';
import { ChannelHubModule } from '../channel-hub/channel-hub.module';
import { MessagingModule } from '../messaging/messaging.module';
import { NfseApiKeyGuard } from './nfse-api-key.guard';
import { NfseController } from './nfse.controller';
import { NfseService } from './nfse.service';
import { NfseWhatsappSender } from './nfse-whatsapp-sender.service';

/** Envio da NFS-e de guiamento pelo WhatsApp, chamado pelo OFP Hub. */
@Module({
  imports: [forwardRef(() => MessagingModule), forwardRef(() => ChannelHubModule)],
  controllers: [NfseController],
  providers: [NfseService, NfseWhatsappSender, NfseApiKeyGuard],
})
export class NfseModule {}
