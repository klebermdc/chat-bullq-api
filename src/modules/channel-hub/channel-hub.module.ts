import { Logger, Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { WebhookGatewayController } from './webhook-gateway.controller';
import { ChannelsController } from './channels/channels.controller';
import { ChannelsService } from './channels/channels.service';
import { ChannelsRepository } from './channels/channels.repository';
import { ZappfyModule } from './adapters/zappfy/zappfy.module';
import { ZappfyInboundAdapter } from './adapters/zappfy/zappfy.inbound-adapter';
import { ZappfyOutboundAdapter } from './adapters/zappfy/zappfy.outbound-adapter';
import { ZappfySyncAdapter } from './adapters/zappfy/zappfy.sync-adapter';
import { WhatsAppOfficialModule } from './adapters/whatsapp-official/whatsapp-official.module';
import { WhatsAppOfficialInboundAdapter } from './adapters/whatsapp-official/whatsapp-official.inbound-adapter';
import { WhatsAppOfficialOutboundAdapter } from './adapters/whatsapp-official/whatsapp-official.outbound-adapter';
import { WhatsAppEmbeddedSignupService } from './adapters/whatsapp-official/whatsapp-embedded-signup.service';
import { InstagramModule } from './adapters/instagram/instagram.module';
import { InstagramInboundAdapter } from './adapters/instagram/instagram.inbound-adapter';
import { InstagramOutboundAdapter } from './adapters/instagram/instagram.outbound-adapter';
import { InstagramSyncAdapter } from './adapters/instagram/instagram.sync-adapter';
import { ChannelSyncOrchestrator } from './sync/channel-sync.orchestrator';
import { ChannelSyncProcessor } from './sync/channel-sync.processor';
import { CHANNEL_SYNC_QUEUE } from './sync/channel-sync.constants';
import { MessagingModule } from '../messaging/messaging.module';
import { WebhookEventsService } from './webhook-events.service';
import { WebhookThrottleGuard } from './webhook-throttle.guard';
import { AccountUpdateService } from './account-update.service';
import { CoexistenceHistoryService } from './coexistence-history.service';
import { CoexistenceContactsService } from './coexistence-contacts.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { MessageTemplatesModule } from './message-templates/message-templates.module';
import {
  InboundDropReporter,
  INBOUND_DROP_REDIS,
} from './inbound-drop-reporter.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'inbound-messages' },
      { name: 'outbound-messages' },
      { name: 'notifications' },
      { name: 'media-processor' },
      { name: 'chatbot-processor' },
      { name: 'conversation-router' },
      { name: 'sla-timers' },
      { name: CHANNEL_SYNC_QUEUE },
    ),
    ZappfyModule,
    WhatsAppOfficialModule,
    InstagramModule,
    forwardRef(() => MessagingModule),
    forwardRef(() => MessageTemplatesModule),
    // AccountUpdateService avisa OWNER/ADMIN quando a Meta desconecta ou
    // restringe a conta, e o InboundDropReporter alerta descarte de inbound.
    // forwardRef por segurança: notifications puxa messaging, que puxa
    // channel-hub.
    forwardRef(() => NotificationsModule),
  ],
  controllers: [WebhookGatewayController, ChannelsController],
  providers: [
    ChannelAdapterRegistry,
    ChannelsService,
    ChannelsRepository,
    ChannelSyncOrchestrator,
    ChannelSyncProcessor,
    WebhookEventsService,
    WebhookThrottleGuard,
    AccountUpdateService,
    CoexistenceHistoryService,
    CoexistenceContactsService,
    WhatsAppEmbeddedSignupService,
    InboundDropReporter,
    {
      provide: INBOUND_DROP_REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('InboundDropRedis');
        // Este cliente fica no caminho do webhook de entrada. Se o Redis cair,
        // é melhor perder o throttle do alerta em ~300ms do que segurar a
        // resposta ao provedor por ~11s com os defaults do ioredis.
        const client = new Redis({
          host: config.get<string>('redis.host', 'localhost'),
          port: config.get<number>('redis.port', 6379),
          password: config.get<string>('redis.password') || undefined,
          maxRetriesPerRequest: 1,
          enableOfflineQueue: false,
          commandTimeout: 300,
        });
        client.on('error', (err) => logger.error(`Redis: ${err.message}`));
        return client;
      },
    },
  ],
  exports: [
    ChannelAdapterRegistry,
    ChannelsService,
    ChannelSyncOrchestrator,
    WebhookEventsService,
    InstagramModule,
    ZappfyModule,
  ],
})
export class ChannelHubModule implements OnModuleInit {
  constructor(
    private readonly registry: ChannelAdapterRegistry,
    private readonly zappfyInbound: ZappfyInboundAdapter,
    private readonly zappfyOutbound: ZappfyOutboundAdapter,
    private readonly zappfySync: ZappfySyncAdapter,
    private readonly waOfficialInbound: WhatsAppOfficialInboundAdapter,
    private readonly waOfficialOutbound: WhatsAppOfficialOutboundAdapter,
    private readonly instagramInbound: InstagramInboundAdapter,
    private readonly instagramOutbound: InstagramOutboundAdapter,
    private readonly instagramSync: InstagramSyncAdapter,
  ) {}

  onModuleInit() {
    this.registry.register(this.zappfyInbound, this.zappfyOutbound);
    this.registry.register(this.waOfficialInbound, this.waOfficialOutbound);
    this.registry.register(this.instagramInbound, this.instagramOutbound);
    this.registry.registerHistorySync(this.zappfySync);
    this.registry.registerHistorySync(this.instagramSync);
  }
}
