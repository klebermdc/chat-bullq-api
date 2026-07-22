import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from '../../database/prisma.module';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ConversationAccessModule } from '../messaging/conversations/conversation-access.module';
import { AiProviderKeysModule } from '../ai-provider-keys/ai-provider-keys.module';
import { CallsService } from './calls.service';
import { SonaxSettingsService } from './sonax-settings.service';
import { SonaxClient } from './sonax-client';
import { CallsController } from './calls.controller';
import { SonaxSettingsController } from './sonax-settings.controller';
import { SonaxWebhookController } from './sonax-webhook.controller';
import { SonaxWebhookService } from './sonax-webhook.service';
import { CallInsightService } from './call-insight.service';
import { RecordingDownloader } from './recording-downloader';
import { CallInsightProcessor } from './call-insight.processor';
import { CALL_INSIGHT_QUEUE } from './call-insight.constants';

@Module({
  imports: [
    PrismaModule,
    CryptoModule,
    RealtimeModule,
    MessagingModule,
    ConversationAccessModule,
    AiProviderKeysModule,
    BullModule.registerQueue({ name: CALL_INSIGHT_QUEUE }),
  ],
  controllers: [CallsController, SonaxSettingsController, SonaxWebhookController],
  providers: [
    CallsService,
    SonaxSettingsService,
    SonaxClient,
    SonaxWebhookService,
    CallInsightService,
    RecordingDownloader,
    CallInsightProcessor,
  ],
  exports: [SonaxSettingsService],
})
export class CallsModule {}
