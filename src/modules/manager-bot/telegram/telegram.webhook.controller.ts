import { Body, Controller, Headers, HttpCode, Logger, Param, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../../common/decorators';
import { ManagerBotAccess, sameCode, type TelegramUpdate } from '../manager-bot.access';

/** Segredo no caminho e no header (setWebhook com secret_token). */
export function isValidWebhook(
  pathSecret: string,
  headerSecret: string | undefined,
  expected: string | undefined = process.env.TELEGRAM_WEBHOOK_SECRET,
): boolean {
  if (!expected || !headerSecret) return false;
  return sameCode(pathSecret, expected) && sameCode(headerSecret, expected);
}

/**
 * Webhook do bot. Sempre 200: erro aqui faria o Telegram reenviar a mesma
 * mensagem em loop. Segredo errado é ignorado em silêncio.
 */
@ApiExcludeController()
@Controller('manager-bot/telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(private readonly access: ManagerBotAccess) {}

  @Post(':secret')
  @Public()
  @HttpCode(200)
  async receive(
    @Param('secret') secret: string,
    @Headers('x-telegram-bot-api-secret-token') header: string | undefined,
    @Body() update: TelegramUpdate,
  ): Promise<{ ok: true }> {
    if (!isValidWebhook(secret, header)) {
      this.logger.warn('gerente_tg_webhook_segredo_invalido');
      return { ok: true };
    }
    // Responde já: uma pergunta à IA pode passar do tempo do webhook, e o
    // Telegram reenviaria a mesma mensagem (resposta em dobro).
    void this.access.handleUpdate(update ?? {}, new Date()).catch((err: unknown) => {
      this.logger.error(`gerente_tg_webhook_falhou: ${err instanceof Error ? err.message : String(err)}`);
    });
    return { ok: true };
  }
}
