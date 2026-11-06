/*
 * Adaptado de DeskcommCRM (https://github.com/melgarafael/DeskcommCRM), MIT License, Copyright (c) 2026 Rafael Melgaço.
 * Origem: lib/notifications/web_push.ts e lib/notifications/vapid.ts
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import { isKnownPushService } from './push-endpoints';
import { PushSubscriptionsService } from './push-subscriptions.service';
import { PushPayload } from './push.types';

/** Aviso que não chegou em 1h já perdeu o sentido. */
const PUSH_TTL_SECONDS = 60 * 60;
const GONE_STATUSES: ReadonlySet<number> = new Set([404, 410]);

export interface SendResult {
  sent: number;
  gone: number;
  failed: number;
}

const NOTHING: SendResult = { sent: 0, gone: 0, failed: 0 };

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function readVapidConfig(config: ConfigService): VapidConfig | null {
  const publicKey = (config.get<string>('VAPID_PUBLIC_KEY') ?? '').trim();
  const privateKey = (config.get<string>('VAPID_PRIVATE_KEY') ?? '').trim();
  const subject = (config.get<string>('VAPID_SUBJECT') ?? '').trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/**
 * O funil: todo push do produto sai daqui. Sem as chaves VAPID o push fica
 * desligado sem erro (o som e o sino do app seguem iguais). Só envia para
 * serviço de push conhecido e apaga a inscrição morta (404/410).
 */
@Injectable()
export class PushSenderService {
  private readonly logger = new Logger(PushSenderService.name);
  private readonly vapid: VapidConfig | null;

  constructor(
    config: ConfigService,
    private readonly subscriptions: PushSubscriptionsService,
  ) {
    this.vapid = readVapidConfig(config);
    if (!this.vapid) {
      this.logger.log('Web Push desligado: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT ausentes');
    }
  }

  isEnabled(): boolean {
    return this.vapid !== null;
  }

  publicKey(): string | null {
    return this.vapid?.publicKey ?? null;
  }

  async sendToUser(userId: string, organizationId: string, payload: PushPayload): Promise<SendResult> {
    const vapid = this.vapid;
    if (!vapid) return NOTHING;
    const rows = (await this.subscriptions.listActive(userId, organizationId, new Date())).filter((r) =>
      isKnownPushService(r.endpoint),
    );
    if (rows.length === 0) return NOTHING;

    const body = JSON.stringify(payload);
    const outcomes = await Promise.all(
      rows.map(async (row): Promise<keyof SendResult> => {
        try {
          await webpush.sendNotification(
            { endpoint: row.endpoint, keys: { p256dh: row.p256dhKey, auth: row.authKey } },
            body,
            { TTL: PUSH_TTL_SECONDS, urgency: 'high', vapidDetails: vapid },
          );
          return 'sent';
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode ?? 0;
          if (GONE_STATUSES.has(status)) {
            await this.subscriptions.removeById(row.id);
            return 'gone';
          }
          this.logger.warn(`web push falhou (status ${status}) sub=${row.id}`);
          return 'failed';
        }
      }),
    );
    return outcomes.reduce<SendResult>((acc, k) => ({ ...acc, [k]: acc[k] + 1 }), NOTHING);
  }
}
