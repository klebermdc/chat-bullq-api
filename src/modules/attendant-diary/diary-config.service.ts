import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DEFAULT_DIARY_CRON, DEFAULT_DIARY_TIMEZONE } from './diary.constants';

/**
 * Quem recebe o diário. Item com "@" na frente é um domínio inteiro: todos os
 * atendentes (papel AGENT) daquele domínio. Os demais são e-mails avulsos, de
 * qualquer papel, para incluir um gestor que também atende.
 */
export interface DiaryParticipantFilter {
  emails: string[];
  domains: string[];
}

/**
 * Configuração do diário, lida do ambiente. A lista é a chave do recurso:
 * vazia, nada roda e nada é gasto com IA.
 */
@Injectable()
export class DiaryConfigService {
  constructor(private readonly config: ConfigService) {}

  get participants(): DiaryParticipantFilter {
    const entries = (this.config.get<string>('ATTENDANT_DIARY_USER_EMAILS') ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    return {
      emails: entries.filter((entry) => !entry.startsWith('@')),
      domains: entries.filter((entry) => entry.startsWith('@')),
    };
  }

  get isEnabled(): boolean {
    const { emails, domains } = this.participants;
    return emails.length > 0 || domains.length > 0;
  }

  get cronPattern(): string {
    return this.config.get<string>('ATTENDANT_DIARY_CRON') ?? DEFAULT_DIARY_CRON;
  }

  get cronTimeZone(): string {
    return this.config.get<string>('ATTENDANT_DIARY_TZ') ?? DEFAULT_DIARY_TIMEZONE;
  }
}
