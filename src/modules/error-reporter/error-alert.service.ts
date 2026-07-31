import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorIssue, ErrorIssueStatus, ErrorSeverity } from '@prisma/client';
import axios from 'axios';
import { PrismaService } from '../../database/prisma.service';
import { AlertKind } from './error-reporter.types';

/**
 * Alerta de incidente no Telegram.
 *
 * Bate DIRETO na API do Telegram, sem passar por nada da infra WhatsApp —
 * que é justamente metade do que este módulo monitora. Se o canal oficial
 * cair, o alerta ainda tem que chegar.
 */

const COOLDOWN_MS: Record<ErrorSeverity, number> = {
  CRITICAL: 10 * 60_000,
  ERROR: 60 * 60_000,
  WARNING: 60 * 60_000,
};

/** Acima disso numa janela de 5min, manda um resumo em vez de N mensagens. */
const STORM_THRESHOLD = 5;
const STORM_WINDOW_MS = 5 * 60_000;

const SEVERITY_ICON: Record<ErrorSeverity, string> = {
  CRITICAL: '🔴',
  ERROR: '🟠',
  WARNING: '🟡',
};

@Injectable()
export class ErrorAlertService {
  private readonly logger = new Logger(ErrorAlertService.name);
  private readonly botToken?: string;
  private readonly chatId?: string;
  private readonly panelBaseUrl: string;

  /**
   * Em memória de propósito: se a API reiniciar no meio de uma tempestade,
   * o pior caso é você receber um resumo extra. O cooldown por issue, esse
   * sim, vive no banco — senão um crashloop mandaria 40 mensagens.
   */
  private lastStormAlertAt: number | null = null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.botToken = config.get<string>('TELEGRAM_ALERT_BOT_TOKEN');
    this.chatId = config.get<string>('TELEGRAM_ALERT_CHAT_ID');
    this.panelBaseUrl =
      config.get<string>('ALERT_PANEL_BASE_URL') ?? 'http://localhost:3000';
    if (!this.botToken || !this.chatId) {
      this.logger.warn(
        'Alerta de erro DESLIGADO: falta TELEGRAM_ALERT_BOT_TOKEN ou TELEGRAM_ALERT_CHAT_ID',
      );
    }
  }

  private get enabled(): boolean {
    return Boolean(this.botToken && this.chatId);
  }

  async maybeAlert(issue: ErrorIssue, kind: AlertKind): Promise<void> {
    if (!this.enabled) return;

    const now = new Date();

    if (
      issue.status === ErrorIssueStatus.MUTED &&
      issue.mutedUntil &&
      issue.mutedUntil > now
    ) {
      return;
    }

    if (kind === 'recurring' && issue.lastAlertedAt) {
      const elapsed = now.getTime() - issue.lastAlertedAt.getTime();
      if (elapsed < COOLDOWN_MS[issue.severity]) return;
    }

    if (await this.handledAsStorm(now)) return;

    await this.send(this.format(issue, kind));
    await this.prisma.errorIssue
      .update({ where: { id: issue.id }, data: { lastAlertedAt: now } })
      .catch((err: Error) =>
        this.logger.error(`falha ao gravar lastAlertedAt: ${err.message}`),
      );
  }

  /** true = estamos em tempestade e o alerta individual foi suprimido. */
  private async handledAsStorm(now: Date): Promise<boolean> {
    const since = new Date(now.getTime() - STORM_WINDOW_MS);
    const novos = await this.prisma.errorIssue.count({
      where: { firstSeenAt: { gte: since } },
    });
    if (novos <= STORM_THRESHOLD) return false;

    const ultimo = this.lastStormAlertAt;
    if (!ultimo || now.getTime() - ultimo >= STORM_WINDOW_MS) {
      this.lastStormAlertAt = now.getTime();
      await this.send(
        `⚠️ <b>Tempestade de erros</b>\n${novos} problemas novos nos últimos 5 minutos.\n→ ${this.panelBaseUrl}/bugs`,
      );
    }
    return true;
  }

  private format(issue: ErrorIssue, kind: AlertKind): string {
    const icon = SEVERITY_ICON[issue.severity];
    const cabecalho =
      kind === 'regression'
        ? `${icon} <b>REGRESSÃO</b> · ${issue.source}`
        : `${icon} <b>${issue.severity}</b> · ${issue.source}`;
    const org = issue.organizationId ? `\nOrg: ${issue.organizationId}` : '';
    const vezes =
      issue.count > 1 ? `\n${issue.count} ocorrências desde a primeira vez` : '';
    return [
      cabecalho,
      escapeHtml(issue.title),
      `<code>${escapeHtml(issue.code)}</code>${org}${vezes}`,
      `→ ${this.panelBaseUrl}/bugs/${issue.id}`,
    ].join('\n');
  }

  private async send(text: string): Promise<void> {
    try {
      await axios.post(
        `https://api.telegram.org/bot${this.botToken}/sendMessage`,
        {
          chat_id: this.chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        },
        { timeout: 5000 },
      );
    } catch (err) {
      // Nunca propaga: o alerta é acessório, não pode derrubar o caminho
      // que estava só tentando registrar um erro.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`falha ao enviar alerta no Telegram: ${msg}`);
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
