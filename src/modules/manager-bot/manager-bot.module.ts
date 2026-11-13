import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { LlmModule } from '../ai-agents/llm/llm.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { AssistantService, MANAGER_BOT_HISTORY, type HistoryStore } from './assistant/assistant.service';
import { AssistantTools } from './assistant/assistant.tools';
import { SlaManagerAlertsModule } from '../response-sla/manager-alerts/manager-alerts.module';
import type { ThrottleStore } from '../response-sla/manager-alerts/manager-alerts.throttle';
import { TeamPresenceModule } from '../team-presence/team-presence.module';
import { WhatsappCostsModule } from '../whatsapp-costs/whatsapp-costs.module';
import { ManagerBotAccess } from './manager-bot.access';
import { ManagerBotController } from './manager-bot.controller';
import { ManagerBotCron, ManagerBotProcessor } from './manager-bot.cron';
import { ManagerBotReportsService } from './manager-bot.reports.service';
import { ManagerBotRepository } from './manager-bot.repository';
import { ManagerBotService } from './manager-bot.service';
import { ManagerBotThrottle } from './manager-bot.throttle';
import { MANAGER_BOT_QUEUE, MANAGER_BOT_THROTTLE } from './manager-bot.types';
import { TelegramClient } from './telegram/telegram.client';
import { TelegramWebhookController } from './telegram/telegram.webhook.controller';

/**
 * Gerente no Telegram (`organizations.settings.managerBot`; ausente = desligado).
 * Env: TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET. Prisma e ErrorReporter são @Global.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: MANAGER_BOT_QUEUE }),
    DashboardModule,
    SlaManagerAlertsModule,
    TeamPresenceModule,
    LlmModule,
    WhatsappCostsModule,
  ],
  controllers: [ManagerBotController, TelegramWebhookController],
  providers: [
    ManagerBotRepository,
    ManagerBotReportsService,
    ManagerBotService,
    ManagerBotAccess,
    AssistantTools,
    AssistantService,
    {
      provide: MANAGER_BOT_HISTORY,
      // Memória curta das perguntas no mesmo Redis da fila.
      useFactory: (queue: Queue) => () => queue.client as unknown as Promise<HistoryStore>,
      inject: [getQueueToken(MANAGER_BOT_QUEUE)],
    },
    ManagerBotCron,
    ManagerBotProcessor,
    { provide: TelegramClient, useFactory: () => new TelegramClient(process.env.TELEGRAM_BOT_TOKEN) },
    {
      provide: MANAGER_BOT_THROTTLE,
      // A trava usa a conexão Redis da própria fila: sem cliente novo.
      useFactory: (queue: Queue) =>
        new ManagerBotThrottle(() => queue.client as unknown as Promise<ThrottleStore>),
      inject: [getQueueToken(MANAGER_BOT_QUEUE)],
    },
  ],
})
export class ManagerBotModule {}
