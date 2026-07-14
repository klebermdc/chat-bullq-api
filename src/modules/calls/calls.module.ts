import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CallsService } from './calls.service';
import { SonaxSettingsService } from './sonax-settings.service';
import { SonaxClient } from './sonax-client';
import { CallsController } from './calls.controller';
import { SonaxSettingsController } from './sonax-settings.controller';
import { SonaxWebhookController } from './sonax-webhook.controller';
import { SonaxWebhookService } from './sonax-webhook.service';

@Module({
  imports: [PrismaModule, CryptoModule, RealtimeModule],
  controllers: [CallsController, SonaxSettingsController, SonaxWebhookController],
  providers: [CallsService, SonaxSettingsService, SonaxClient, SonaxWebhookService],
  exports: [SonaxSettingsService],
})
export class CallsModule {}
