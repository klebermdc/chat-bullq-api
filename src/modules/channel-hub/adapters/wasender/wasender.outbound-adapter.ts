import { Injectable, Logger } from '@nestjs/common';
import { ChannelType, Channel } from '@prisma/client';
import { OutboundChannelPort } from '../../ports/outbound-channel.port';
import {
  NormalizedOutboundMessage,
  SendResult,
  RateLimitConfig,
} from '../../ports/types';
import { WasenderMessageMapper } from './wasender.message-mapper';
import { WasenderHttpClient } from './wasender.http-client';

@Injectable()
export class WasenderOutboundAdapter implements OutboundChannelPort {
  readonly channelType = ChannelType.WHATSAPP_WASENDER;
  private readonly logger = new Logger(WasenderOutboundAdapter.name);

  constructor(
    private readonly mapper: WasenderMessageMapper,
    private readonly httpClient: WasenderHttpClient,
  ) {}

  async sendMessage(
    channel: Channel,
    contactExternalId: string,
    message: NormalizedOutboundMessage,
  ): Promise<SendResult> {
    const { endpoint, payload } = this.mapper.denormalize(
      message,
      contactExternalId,
    );
    const response = await this.httpClient.sendRequest(channel, endpoint, payload);
    const data = response?.data ?? response;
    return {
      externalId:
        data?.msgId ||
        data?.messageId ||
        data?.message_id ||
        data?.key?.id ||
        data?.id ||
        '',
      providerResponse: response,
    };
  }

  async sendTypingIndicator(
    channel: Channel,
    contactExternalId: string,
  ): Promise<void> {
    const to = contactExternalId.replace(/@s\.whatsapp\.net|@g\.us|@lid/g, '');
    try {
      await this.httpClient.sendPresence(channel, to, 'composing');
    } catch (error: any) {
      this.logger.warn(`Typing indicator failed: ${error.message}`);
    }
  }

  async getMediaUrl(_channel: Channel, mediaId: string): Promise<string> {
    return mediaId;
  }

  async downloadMedia(channel: Channel, mediaId: string): Promise<Buffer> {
    return this.httpClient.getMediaBuffer(channel, mediaId);
  }

  async resolveInboundMediaUrl(
    channel: Channel,
    hint: { externalMessageId: string },
  ): Promise<{ fileUrl: string; mimeType?: string }> {
    return this.httpClient.resolveInboundMediaUrl(
      channel,
      hint.externalMessageId,
    );
  }

  async deleteMessage(
    channel: Channel,
    externalMessageId: string,
  ): Promise<void> {
    await this.httpClient.deleteMessage(channel, externalMessageId);
  }

  getRateLimits(): RateLimitConfig {
    return {
      maxPerSecond: 1,
      maxPerMinute: 30,
      windowMs: 60000,
    };
  }
}
