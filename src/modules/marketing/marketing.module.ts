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
import { HealthIndicatorsService } from './metrics/health-indicators.service';
import { MarketingRepository } from './metrics/marketing.repository';
import { MarketingMetricsService } from './metrics/marketing-metrics.service';
import { MarketingMetricsController } from './metrics/marketing-metrics.controller';
import { MarketingGoalsService } from './goals/marketing-goals.service';
import { MarketingGoalsController } from './goals/marketing-goals.controller';

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
  controllers: [AdConnectionController, MarketingMetricsController, MarketingGoalsController],
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
    HealthIndicatorsService,
    MarketingRepository,
    MarketingMetricsService,
    MarketingGoalsService,
  ],
})
export class MarketingModule {}
