import { Injectable } from '@nestjs/common';
import { chunkMessage } from '../manager-bot.format';

const API_BASE = 'https://api.telegram.org';
const TIMEOUT_MS = 10_000;

export interface TelegramSendResult {
  ok: boolean;
  error?: string;
}

type FetchFn = typeof fetch;

/** Envio pela Bot API do Telegram (HTML). Nunca lança: erro vira `ok:false`. */
@Injectable()
export class TelegramClient {
  constructor(
    private readonly token: string | undefined = process.env.TELEGRAM_BOT_TOKEN,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  isConfigured(): boolean {
    return !!this.token;
  }

  async sendMessage(chatId: string, text: string): Promise<TelegramSendResult> {
    if (!this.token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN ausente' };
    for (const chunk of chunkMessage(text)) {
      const result = await this.post(chatId, chunk);
      if (!result.ok) return result;
    }
    return { ok: true };
  }

  /** Mostra "digitando…" por ~5 s. Nunca lança. */
  async sendTyping(chatId: string): Promise<void> {
    if (!this.token) return;
    try {
      await this.fetchFn(`${API_BASE}/bot${this.token}/sendChatAction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // indicador visual apenas
    }
  }

  private async post(chatId: string, text: string): Promise<TelegramSendResult> {
    try {
      const response = await this.fetchFn(`${API_BASE}/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; description?: string };
      if (response.ok && body.ok) return { ok: true };
      return { ok: false, error: body.description ?? `HTTP ${response.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
