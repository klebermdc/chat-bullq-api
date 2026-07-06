import { Injectable, Logger } from '@nestjs/common';
import { Channel, ChannelType } from '@prisma/client';
import * as crypto from 'crypto';
import {
  InboundChannelPort,
  ChannelLocator,
} from '../../ports/inbound-channel.port';
import { WebhookParseResult, VerificationResponse } from '../../ports/types';
import { WasenderMessageMapper } from './wasender.message-mapper';

@Injectable()
export class WasenderInboundAdapter implements InboundChannelPort {
  readonly channelType = ChannelType.WHATSAPP_WASENDER;
  private readonly logger = new Logger(WasenderInboundAdapter.name);

  constructor(private readonly mapper: WasenderMessageMapper) {}

  extractLocators(
    payload: unknown,
    headers: Record<string, string>,
  ): ChannelLocator[] {
    const event = (payload ?? {}) as Record<string, any>;
    // O Wasender manda o id da sessão no envelope; a assinatura vem no header.
    const sessionId =
      event?.sessionId ??
      event?.session_id ??
      event?.data?.sessionId ??
      event?.data?.session_id ??
      event?.session?.id ??
      undefined;
    const signature =
      headers['x-webhook-signature'] || headers['x-wasender-signature'];

    const locator: ChannelLocator = {};
    if (sessionId != null) locator.instanceId = String(sessionId);
    if (signature) locator.token = String(signature);
    // Sempre retorna ao menos um locator — o resolver tenta casar por
    // sessionId (forte) ou pela assinatura == webhookSecret do canal.
    return [locator];
  }

  matchesChannel(channel: Channel, locator: ChannelLocator): boolean {
    const config = (channel.config ?? {}) as Record<string, any>;

    // 1. Match forte por sessionId — preferido sempre que presente.
    if (locator.instanceId && config.sessionId) {
      return String(config.sessionId) === locator.instanceId;
    }

    // 2. Match pela assinatura do webhook (== webhookSecret da sessão).
    if (locator.token && channel.webhookSecret) {
      return this.timingSafeEqualStr(channel.webhookSecret, String(locator.token));
    }

    // Sem sessionId no payload E sem secret configurado não dá pra
    // distinguir instâncias com segurança — recusa pra evitar vazamento
    // cross-tenant (o provisionamento sempre grava sessionId no config).
    return false;
  }

  validateWebhook(
    headers: Record<string, string>,
    _rawBody: Buffer,
    webhookSecret?: string,
    _channel?: Channel,
  ): boolean {
    // Assinatura do Wasender é comparação simples do secret via header
    // `X-Webhook-Signature` (NÃO é HMAC). Se o canal não tem secret
    // configurado, aceitamos (o match por sessionId já roteou o evento).
    if (!webhookSecret) return true;
    const candidate =
      headers['x-webhook-signature'] || headers['x-wasender-signature'];
    if (!candidate) return false;
    return this.timingSafeEqualStr(webhookSecret, String(candidate));
  }

  parseWebhook(payload: unknown, _channel?: Channel): WebhookParseResult {
    const result: WebhookParseResult = {
      messages: [],
      statuses: [],
      errors: [],
    };

    try {
      const event = payload as any;
      const type = String(event?.event || event?.type || '').toLowerCase();

      if (
        type === 'messages.upsert' ||
        type === 'messages.received' ||
        type === 'personal.message.received' ||
        type === 'group.message.received'
      ) {
        const normalized = this.mapper.normalizeInbound(event);
        if (normalized) result.messages.push(normalized);
      } else if (
        type === 'messages.update' ||
        type === 'message.receipt.update'
      ) {
        const status = this.mapper.normalizeStatus(event);
        if (status) result.statuses.push(status);
      }
      // session.status / qrcode.updated e afins são ignorados aqui — o estado
      // de conexão é consultado sob demanda pelos endpoints de sessão.
    } catch (error: any) {
      this.logger.error(`Failed to parse Wasender webhook: ${error.message}`);
      result.errors.push({
        code: 'PARSE_ERROR',
        message: error.message,
        rawData: payload,
      });
    }

    return result;
  }

  handleVerification(
    _query: Record<string, string>,
    _webhookSecret?: string,
  ): VerificationResponse {
    return { statusCode: 200, body: 'OK' };
  }

  private timingSafeEqualStr(a: string, b: string): boolean {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    try {
      return crypto.timingSafeEqual(ba, bb);
    } catch {
      return false;
    }
  }
}
