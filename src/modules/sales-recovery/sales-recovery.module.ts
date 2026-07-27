import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PipelinesModule } from '../pipelines/pipelines.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RecoveryConfigService } from './recovery-config.service';
import { RecoveryCardsRepository } from './recovery-cards.repository';
import { RecoveryOutreachService } from './recovery-outreach.service';
import { SalesRecoveryService } from './sales-recovery.service';
import { RecoverySettingsService } from './recovery-settings.service';
import { RecoverySettingsRepository } from './recovery-settings.repository';
import { RecoveryWatchdogCron } from './recovery-watchdog.cron';
import { RecoveryOutreachProcessor } from './recovery-outreach.processor';
import { RecoverySettingsController } from './recovery-settings.controller';
import { KirvanoWebhookController } from './webhooks/kirvano-webhook.controller';
import { KirvanoEventsService } from './webhooks/kirvano-events.service';
import { KirvanoEventsProcessor } from './webhooks/kirvano-events.processor';
import {
  KIRVANO_EVENTS_QUEUE,
  RECOVERY_WATCHDOG_QUEUE,
  RECOVERY_OUTREACH_QUEUE,
} from './sales-recovery.constants';

/**
 * Recuperação de Vendas: webhooks da Kirvano + cold outreach por IA movendo
 * um pipeline kanban automaticamente. Reusa PipelinesService pra toda mutação
 * de card (ordem/status/eventos socket). Exporta SalesRecoveryService pro
 * pipeline de inbound chamar `onInboundReply` (Tentativa → Em Contato).
 */
@Module({
  imports: [
    BullModule.registerQueue(
      { name: KIRVANO_EVENTS_QUEUE },
      { name: RECOVERY_WATCHDOG_QUEUE },
      { name: RECOVERY_OUTREACH_QUEUE },
      { name: 'outbound-messages' },
    ),
    // Task 10: PipelinesModule agora importa (forwardRef) MessagingModule, e
    // MessagingModule importa este SalesRecoveryModule → ciclo de 3 módulos
    // pipelines→messaging→sales-recovery→pipelines. Este forwardRef quebra a
    // aresta de volta (sales-recovery→pipelines) pra Nest resolver a ordem.
    forwardRef(() => PipelinesModule),
    RealtimeModule,
  ],
  controllers: [KirvanoWebhookController, RecoverySettingsController],
  providers: [
    RecoveryConfigService,
    RecoveryCardsRepository,
    RecoveryOutreachService,
    SalesRecoveryService,
    RecoverySettingsService,
    RecoverySettingsRepository,
    KirvanoEventsService,
    KirvanoEventsProcessor,
    RecoveryWatchdogCron,
    RecoveryOutreachProcessor,
  ],
  exports: [SalesRecoveryService],
})
export class SalesRecoveryModule {}
