import { Injectable, Logger } from '@nestjs/common';
import { Channel, ChannelType } from '@prisma/client';
import { OutboundChannelPort } from '../../ports/outbound-channel.port';
import { NormalizedOutboundMessage, SendResult, RateLimitConfig } from '../../ports/types';
import { MessengerMessageMapper } from './messenger.message-mapper';
import { MessengerHttpClient } from './messenger.http-client';

@Injectable()
export class MessengerOutboundAdapter implements OutboundChannelPort {
  readonly channelType = ChannelType.MESSENGER;
  private readonly logger = new Logger(MessengerOutboundAdapter.name);

  constructor(
    private readonly mapper: MessengerMessageMapper,
    private readonly httpClient: MessengerHttpClient,
  ) {}

  async sendMessage(
    channel: Channel,
    contactExternalId: string,
    message: NormalizedOutboundMessage,
  ): Promise<SendResult> {
    const payload = this.mapper.denormalize(message, contactExternalId);
    const response = await this.httpClient.sendMessage(channel, payload);

    return {
      externalId: response?.message_id || '',
      providerResponse: response,
    };
  }

  async sendTypingIndicator(channel: Channel, contactExternalId: string): Promise<void> {
    try {
      await this.httpClient.sendMessage(channel, {
        recipient: { id: contactExternalId },
        sender_action: 'typing_on',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Indicador de digitacao do Messenger falhou: ${message}`);
    }
  }

  async getMediaUrl(_channel: Channel, mediaId: string): Promise<string> {
    return mediaId;
  }

  async downloadMedia(_channel: Channel, mediaUrl: string): Promise<Buffer> {
    return this.httpClient.downloadMedia(mediaUrl);
  }

  /**
   * A Meta nao expoe endpoint de unsend pra Page/Messenger na Send API
   * (diferente do Instagram, onde a tentativa via Graph as vezes funciona
   * para tokens com permissao especial). Aqui nem tentamos: falhamos direto
   * com o motivo, pro service fazer fallback de soft-delete local. Mesmo
   * tratamento e mesma mensagem do `instagram.outbound-adapter.ts`.
   */
  async deleteMessage(_channel: Channel, externalMessageId: string): Promise<void> {
    throw new Error(
      `A Meta nao permite remover mensagens ja entregues no Messenger via API ` +
        `(id=${externalMessageId}). Marcamos como deletada apenas no Sendtur.`,
    );
  }

  getRateLimits(): RateLimitConfig {
    return { maxPerSecond: 200, maxPerMinute: 5000, windowMs: 60000 };
  }
}
