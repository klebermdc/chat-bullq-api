import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { LlmModule } from '../ai-agents/llm/llm.module';
import { TelegramClient } from '../manager-bot/telegram/telegram.client';
import { BotRepository } from './bot/bot.repository';
import { BotService } from './bot/bot.service';
import { MYSTERY_SHOPPER_QUEUE } from './mystery-shopper.constants';
import { MysteryShopperAccess } from './mystery-shopper.access';
import { MysteryShopperController } from './mystery-shopper.controller';
import { MysteryShopperCriteriaService } from './mystery-shopper-criteria.service';
import { MysteryShopperNotifier } from './mystery-shopper.notifier';
import { MysteryShopperProcessor } from './mystery-shopper.processor';
import { MysteryShopperRepository } from './mystery-shopper.repository';
import { MysteryShopperService } from './mystery-shopper.service';
import { SimulatorService } from './simulated/simulator.service';
import { VisitEvaluatorService } from './visit-evaluator.service';

/**
 * Cliente oculto: visitas de teste da gestão, avaliadas por rubrica.
 * Config em `organizations.settings.mysteryShopper` (viewerEmails, telegramChatIds).
 * Prisma é @Global.
 */
@Module({
  imports: [LlmModule, BullModule.registerQueue({ name: MYSTERY_SHOPPER_QUEUE }, { name: 'inbound-messages' })],
  controllers: [MysteryShopperController],
  providers: [
    MysteryShopperAccess,
    MysteryShopperCriteriaService,
    MysteryShopperRepository,
    MysteryShopperNotifier,
    MysteryShopperService,
    SimulatorService,
    BotRepository,
    BotService,
    VisitEvaluatorService,
    MysteryShopperProcessor,
    { provide: TelegramClient, useFactory: () => new TelegramClient(process.env.TELEGRAM_BOT_TOKEN) },
  ],
})
export class MysteryShopperModule {}
