import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ChannelHubModule } from '../channel-hub/channel-hub.module';
import { RatingsModule } from '../ratings/ratings.module';
import { AiAgentsModule } from '../ai-agents/ai-agents.module';
import { WatchdogModule } from '../routing/watchdog/watchdog.module';
import { RoutingModule } from '../routing/routing.module';
import { SegmentsModule } from '../segments/segments.module';
import { ProjectsModule } from '../projects/projects.module';
import { SalesRecoveryModule } from '../sales-recovery/sales-recovery.module';
import { ChannelUsageModule } from '../channel-usage/channel-usage.module';
import { AiProviderKeysModule } from '../ai-provider-keys/ai-provider-keys.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { CadencesModule } from '../cadences/cadences.module';
import { AttendantGreetingModule } from './attendant-greeting/attendant-greeting.module';
import { OrderFichaModule } from '../order-ficha/order-ficha.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { IdempotencyService } from './pipeline/idempotency.service';
import { MetaWindowGate } from './pipeline/meta-window-gate.service';
import { ContactResolverService } from './pipeline/contact-resolver.service';
import { ConversationResolverService } from './pipeline/conversation-resolver.service';
import { LeadSourceTaggerService } from './pipeline/lead-source-tagger.service';
import { LeadCardService } from './pipeline/lead-card.service';
import { LeadOriginService } from './pipeline/lead-origin.service';
import { HistoryImportService } from './pipeline/history-import.service';
import { InboundMessageProcessor } from './pipeline/inbound-message.processor';
import { OutboundMessageProcessor } from './pipeline/outbound-message.processor';
import { ConversationFsmService } from './conversations/conversation-fsm.service';
import { ConversationAccessModule } from './conversations/conversation-access.module';
import { ConversationsController } from './conversations/conversations.controller';
import { ConversationsService } from './conversations/conversations.service';
import { ConversationsRepository } from './conversations/conversations.repository';
import { StartConversationService } from './conversations/start-conversation.service';
import { MessagesController } from './messages/messages.controller';
import { MessagesService } from './messages/messages.service';
import { MessagesRepository } from './messages/messages.repository';
import { ContactHistoryService } from './messages/contact-history.service';
import { ConversationTranscriptService } from './conversations/conversation-transcript.service';
import { TranscriptionService } from './messages/transcription.service';
import { ConversationSummaryService } from './messages/conversation-summary.service';
import { UploadsService } from './messages/uploads.service';
import { MediaResolverService } from './messages/media-resolver.service';
import { AudioSourceService } from './messages/audio-source.service';
import { PlaybackService } from './messages/playback.service';
import { ContactsController } from './contacts/contacts.controller';
import { ContactsService } from './contacts/contacts.service';
import { ContactsRepository } from './contacts/contacts.repository';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'inbound-messages' },
      { name: 'outbound-messages' },
      { name: 'chatbot-processor' },
    ),
    forwardRef(() => ChannelHubModule),
    ConversationAccessModule,
    RatingsModule,
    AiAgentsModule,
    WatchdogModule,
    SegmentsModule,
    ProjectsModule,
    // Task 10 (hardening): SalesRecoveryModule importa (forwardRef) o
    // PipelinesModule, que importa (forwardRef) este MessagingModule -> ciclo
    // pipelines->messaging->sales-recovery->pipelines. Todas as 3 arestas usam
    // forwardRef pra ficar auto-documentado e imune a reordenacao de imports.
    forwardRef(() => SalesRecoveryModule),
    ChannelUsageModule,
    AiProviderKeysModule,
    forwardRef(() => SchedulingModule),
    // Task 8: inbound processor chama CadenceInboundService → ciclo
    // messaging↔cadences → forwardRef nos dois lados.
    forwardRef(() => CadencesModule),
    forwardRef(() => AttendantGreetingModule),
    OrderFichaModule,
    // Task 4 (agent-hours): InboundMessageProcessor chama
    // AgentAvailabilityService (Routing), e RoutingModule já importa
    // MessagingModule → ciclo routing↔messaging → forwardRef nos dois lados
    // (mesmo padrão de cadences↔messaging acima).
    forwardRef(() => RoutingModule),
    // Task A5: inbound processor dispara notificação persistente NEW_MESSAGE.
    // Aresta one-way (messaging → notifications): NotificationsModule só
    // importa BullModule e não referencia MessagingModule, então sem ciclo.
    NotificationsModule,
  ],
  controllers: [ConversationsController, MessagesController, ContactsController],
  providers: [
    IdempotencyService,
    MetaWindowGate,
    ContactResolverService,
    ConversationResolverService,
    LeadSourceTaggerService,
    LeadCardService,
    LeadOriginService,
    HistoryImportService,
    InboundMessageProcessor,
    OutboundMessageProcessor,
    ConversationFsmService,
    ConversationsService,
    ConversationsRepository,
    StartConversationService,
    MessagesService,
    MessagesRepository,
    ContactHistoryService,
    ConversationTranscriptService,
    TranscriptionService,
    ConversationSummaryService,
    UploadsService,
    MediaResolverService,
    AudioSourceService,
    PlaybackService,
    ContactsService,
    ContactsRepository,
  ],
  exports: [ConversationsService, MessagesService, ConversationFsmService, ContactsService, HistoryImportService, UploadsService, TranscriptionService],
})
export class MessagingModule {}
