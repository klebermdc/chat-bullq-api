import { Injectable, Logger } from '@nestjs/common';
import { Channel, ChannelType } from '@prisma/client';
import { InboundChannelPort, ChannelLocator } from '../../ports/inbound-channel.port';
import { WebhookParseResult, VerificationResponse } from '../../ports/types';
import { MessengerMessageMapper } from './messenger.message-mapper';
import {
  verifyMetaSignature,
  handleMetaVerification,
} from '../meta-shared/meta-signature.util';

@Injectable()
export class MessengerInboundAdapter implements InboundChannelPort {
  readonly channelType = ChannelType.MESSENGER;
  private readonly logger = new Logger(MessengerInboundAdapter.name);

  constructor(private readonly mapper: MessengerMessageMapper) {}

  extractLocators(payload: unknown): ChannelLocator[] {
    const body = (payload ?? {}) as Record<string, any>;
    const entries: any[] = Array.isArray(body?.entry) ? body.entry : [];
    const seen = new Set<string>();
    const locators: ChannelLocator[] = [];

    for (const entry of entries) {
      const id = entry?.id ? String(entry.id) : undefined;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      locators.push({ pageId: id });
    }

    return locators;
  }

  matchesChannel(channel: Channel, locator: ChannelLocator): boolean {
    if (!locator.pageId) return false;
    const config = (channel.config ?? {}) as Record<string, any>;
    return config.pageId ? String(config.pageId) === locator.pageId : false;
  }

  validateWebhook(
    headers: Record<string, string>,
    rawBody: Buffer,
    _webhookSecret?: string,
    channel?: Channel,
  ): boolean {
    const appSecret = (channel?.config as Record<string, any> | undefined)?.appSecret;
    return verifyMetaSignature(headers, rawBody, appSecret);
  }

  parseWebhook(payload: unknown, channel?: Channel): WebhookParseResult {
    const result: WebhookParseResult = { messages: [], statuses: [], errors: [] };

    try {
      const body = (payload ?? {}) as Record<string, any>;
      const entries: any[] = Array.isArray(body?.entry) ? body.entry : [];
      if (body?.entry && !Array.isArray(body.entry)) {
        throw new Error('entry nao e um array');
      }

      const expectedPageId = (channel?.config as Record<string, any> | undefined)?.pageId;

      for (const entry of entries) {
        // Escopo estrito: descarta evento de outra Pagina.
        if (expectedPageId && entry?.id && String(entry.id) !== String(expectedPageId)) {
          continue;
        }

        const events: any[] = entry?.messaging ?? [];
        for (const event of events) {
          if (event.message) {
            const normalized = this.mapper.normalizeInbound(event);
            if (normalized) result.messages.push(normalized);
          }
          if (event.delivery) {
            const status = this.mapper.normalizeStatus(event);
            if (status) result.statuses.push(status);
          }
          if (event.read) {
            const status = this.mapper.normalizeReadStatus(event);
            if (status) result.statuses.push(status);
          }
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha ao processar webhook do Messenger: ${message}`);
      result.errors.push({ code: 'PARSE_ERROR', message, rawData: payload });
    }

    return result;
  }

  handleVerification(
    query: Record<string, string>,
    webhookSecret?: string,
  ): VerificationResponse {
    const result = handleMetaVerification(query, webhookSecret);
    if (result.statusCode === 200) {
      this.logger.log('Verificacao do webhook do Messenger bem-sucedida');
    } else {
      this.logger.warn('Verificacao do webhook do Messenger falhou');
    }
    return result;
  }
}
