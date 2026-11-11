import { Injectable, Logger } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { ManagerBotRepository } from './manager-bot.repository';
import { ManagerBotService, type BotTarget } from './manager-bot.service';
import type { ManagerReportKind } from './manager-bot.types';

export interface TelegramUpdate {
  message?: {
    chat?: { id?: number | string };
    from?: { first_name?: string; last_name?: string };
    text?: string;
  };
}

const START = /^\/start(?:@\w+)?\s+(\S+)$/i;
const LINK_CODE_BYTES = 6;
const COMMANDS: Record<string, ManagerReportKind> = {
  '/placar': 'closing',
  '/manha': 'opening',
  '/semana': 'weekly',
};
export const HELP_TEXT = [
  'Comandos:',
  '/placar — números do dia até agora',
  '/manha — fila e quem está esperando',
  '/semana — resumo da semana passada',
  '',
  'Perguntas livres chegam na próxima versão.',
].join('\n');

export function sameCode(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Trata cada mensagem recebida no bot. Só responde a chats cadastrados; o
 * único jeito de cadastrar é `/start <código>` com o código de uso único.
 */
@Injectable()
export class ManagerBotAccess {
  private readonly logger = new Logger(ManagerBotAccess.name);

  constructor(
    private readonly bot: ManagerBotService,
    private readonly repository: ManagerBotRepository,
  ) {}

  async handleUpdate(update: TelegramUpdate, now: Date): Promise<void> {
    const text = update.message?.text?.trim();
    const rawId = update.message?.chat?.id;
    if (!text || rawId === undefined) return;
    const chatId = String(rawId);
    const targets = await this.bot.listTargets();

    const start = START.exec(text);
    if (start) return this.register(targets, chatId, start[1], update);

    const target = targets.find((t) => t.config.chats.some((c) => c.chatId === chatId));
    if (!target) {
      this.logger.warn(`gerente_tg_chat_desconhecido chat=${chatId}`);
      return;
    }
    await this.answer(target, chatId, text, now);
  }

  private async register(targets: BotTarget[], chatId: string, code: string, update: TelegramUpdate) {
    const target = targets.find((t) => t.config.linkCode && sameCode(t.config.linkCode, code));
    if (!target) {
      this.logger.warn(`gerente_tg_codigo_invalido chat=${chatId}`);
      return;
    }
    const chat = { chatId, name: displayName(update) };
    if (target.config.chats.some((c) => c.chatId === chatId)) {
      await this.bot.broadcast(target, 'Você já está cadastrado.', [chat]);
      return;
    }
    await this.repository.addChat(target.org.id, chat, randomBytes(LINK_CODE_BYTES).toString('hex'));
    this.logger.log(`gerente_tg_chat_cadastrado org=${target.org.id} chat=${chatId} nome=${chat.name}`);
    await this.bot.broadcast(
      target,
      `Olá, ${chat.name}! Você vai receber a abertura (9h), o fechamento (22h10), o resumo de segunda e os alertas do dia.\n\n${HELP_TEXT}`,
      [chat],
    );
  }

  private async answer(target: BotTarget, chatId: string, text: string, now: Date) {
    const chat = target.config.chats.filter((c) => c.chatId === chatId);
    const command = text.split(/[\s@]/)[0].toLowerCase();
    const kind = COMMANDS[command];
    if (!kind) {
      await this.bot.broadcast(target, HELP_TEXT, chat);
      return;
    }
    try {
      const report = await this.bot.buildReport(target.org, kind, now, true);
      await this.bot.broadcast(target, report, chat);
    } catch (err) {
      this.logger.error(`gerente_tg_comando_falhou ${command}: ${err instanceof Error ? err.message : String(err)}`);
      await this.bot.broadcast(target, 'Não consegui buscar os números agora. Tente de novo em alguns minutos.', chat);
    }
  }
}

function displayName(update: TelegramUpdate): string {
  const from = update.message?.from;
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(' ').trim();
  return name || 'Gestor';
}
