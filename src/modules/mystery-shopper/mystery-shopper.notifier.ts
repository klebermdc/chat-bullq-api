// src/modules/mystery-shopper/mystery-shopper.notifier.ts
import { Injectable, Logger } from '@nestjs/common';
import { escapeHtml } from '../manager-bot/manager-bot.format';
import { TelegramClient } from '../manager-bot/telegram/telegram.client';
import { MAX_SCORE_PER_CRITERION } from './mystery-shopper.constants';
import { MysteryShopperAccess } from './mystery-shopper.access';
import type { CriterionScore } from './mystery-shopper.types';

interface DoneInput {
  visitId: string;
  sellerName: string | null;
  totalScore: number | null;
  scores: CriterionScore[];
}

export function buildDoneMessage(input: {
  sellerName: string | null;
  totalScore: number | null;
  scores: CriterionScore[];
  link: string | null;
}): string {
  const weakest = input.scores
    .filter((s) => s.score !== null && s.score < MAX_SCORE_PER_CRITERION)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0];
  return [
    '🕵️ <b>Cliente oculto avaliado</b>',
    `${escapeHtml(input.sellerName ?? 'Sem vendedor')}: <b>${input.totalScore ?? '—'}/100</b>`,
    ...(weakest ? [`Ponto fraco: ${escapeHtml(weakest.label)}`] : []),
    ...(input.link ? [input.link] : []),
  ].join('\n');
}

/** Avisa só os chats de `settings.mysteryShopper.telegramChatIds`. Nunca lança. */
@Injectable()
export class MysteryShopperNotifier {
  private readonly logger = new Logger(MysteryShopperNotifier.name);

  constructor(
    private readonly access: MysteryShopperAccess,
    private readonly telegram: TelegramClient,
  ) {}

  async notifyDone(organizationId: string, input: DoneInput): Promise<void> {
    try {
      const { telegramChatIds } = await this.access.settings(organizationId);
      if (telegramChatIds.length === 0 || !this.telegram.isConfigured()) return;
      const appUrl = process.env.APP_URL?.replace(/\/$/, '');
      const text = buildDoneMessage({
        ...input,
        link: appUrl ? `${appUrl}/cliente-oculto?visita=${input.visitId}` : null,
      });
      for (const chatId of telegramChatIds) {
        const result = await this.telegram.sendMessage(chatId, text);
        if (!result.ok) this.logger.warn(`mystery_notify_failed chat=${chatId}: ${result.error}`);
      }
    } catch (err) {
      this.logger.warn(`mystery_notify_failed visit=${input.visitId}: ${(err as Error).message}`);
    }
  }
}
