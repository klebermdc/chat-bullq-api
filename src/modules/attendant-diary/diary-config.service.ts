import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_DIARY_CRON, DEFAULT_DIARY_TIMEZONE } from './diary.constants';

/**
 * Configuração do diário, lida do ambiente. A lista de e-mails é a chave do
 * recurso: vazia, nada roda e nada é gasto com IA.
 */
@Injectable()
export class DiaryConfigService {
  constructor(private readonly config: ConfigService) {}

  get participantEmails(): string[] {
    return (this.config.get<string>('ATTENDANT_DIARY_USER_EMAILS') ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
  }

  get isEnabled(): boolean {
    return this.participantEmails.length > 0;
  }

  get cronPattern(): string {
    return this.config.get<string>('ATTENDANT_DIARY_CRON') ?? DEFAULT_DIARY_CRON;
  }

  get cronTimeZone(): string {
    return this.config.get<string>('ATTENDANT_DIARY_TZ') ?? DEFAULT_DIARY_TIMEZONE;
  }
}
