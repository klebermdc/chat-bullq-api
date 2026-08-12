import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import {
  MARKETING_SYNC_CRON_QUEUE,
  MARKETING_SYNC_QUEUE,
} from './marketing.constants';
import { marketingRedisProvider } from './marketing-redis.provider';
import { AdConnectionController } from './connection/ad-connection.controller';
import { AdConnectionRepository } from './connection/ad-connection.repository';
import { AdConnectionService } from './connection/ad-connection.service';
import { MetaOAuthClient } from './connection/meta-oauth.client';
import { OAuthHandshakeStore } from './connection/oauth-handshake.store';
import { MarketingSyncCron } from './ingest/marketing-sync.cron';
import { MarketingSyncProcessor } from './ingest/marketing-sync.processor';
import { MarketingSyncQueue } from './ingest/marketing-sync.queue';
import { MetaInsightsClient } from './ingest/meta-insights.client';

// `PrismaModule` e `CryptoModule` sao @Global no projeto — PrismaService e
// CryptoService sao injetaveis sem importar nada aqui.
//
// Nada e exportado: este modulo nao e dependencia de ninguem. E o que impede
// ciclo de injecao, que ja derrubou producao neste projeto.
@Module({
  imports: [
    BullModule.registerQueue(
      { name: MARKETING_SYNC_QUEUE },
      { name: MARKETING_SYNC_CRON_QUEUE },
    ),
  ],
  controllers: [AdConnectionController],
  providers: [
    marketingRedisProvider,
    AdConnectionRepository,
    AdConnectionService,
    MetaOAuthClient,
    OAuthHandshakeStore,
    MarketingSyncQueue,
    MetaInsightsClient,
    MarketingSyncProcessor,
    MarketingSyncCron,
  ],
})
export class MarketingModule {}
