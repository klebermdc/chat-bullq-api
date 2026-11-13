import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import { Channel, ChannelType } from '@prisma/client';
import { OutboundChannelPort } from '../../channel-hub/ports/outbound-channel.port';
import { NormalizedOutboundMessage, RateLimitConfig, SendResult } from '../../channel-hub/ports/types';

export const SIMULATED_DELIVERED_DELAY_MS = 2000;
export const SIMULATED_READ_DELAY_MS = 6000;
const MEDIA_UNAVAILABLE = 'Mídia indisponível em contato simulado';

/**
 * Adaptador que NÃO envia nada: devolve um id falso e agenda os status
 * delivered/read pela mesma fila de entrada que os webhooks da Meta usam.
 * Não é registrado no ChannelAdapterRegistry (só o processor de saída o usa).
 */
@Injectable()
export class SimulatedOutboundAdapter implements OutboundChannelPort {
  readonly channelType: ChannelType = ChannelType.WHATSAPP_OFFICIAL;

  constructor(@InjectQueue('inbound-messages') private readonly inboundQueue: Queue) {}

  async sendMessage(
    channel: Channel,
    _contactExternalId: string,
    _message: NormalizedOutboundMessage,
  ): Promise<SendResult> {
    const externalId = `sim.out.${randomUUID().replace(/-/g, '')}`;
    await this.scheduleStatus(channel, externalId, 'delivered', SIMULATED_DELIVERED_DELAY_MS);
    await this.scheduleStatus(channel, externalId, 'read', SIMULATED_READ_DELAY_MS);
    return { externalId, providerResponse: { simulated: true } };
  }

  async sendTypingIndicator(_channel: Channel, _contactExternalId: string): Promise<void> {}

  async getMediaUrl(_channel: Channel, _mediaId: string): Promise<string> {
    throw new Error(MEDIA_UNAVAILABLE);
  }

  async downloadMedia(_channel: Channel, _mediaId: string): Promise<Buffer> {
    throw new Error(MEDIA_UNAVAILABLE);
  }

  async deleteMessage(_channel?: Channel, _externalMessageId?: string): Promise<void> {}

  getRateLimits(): RateLimitConfig {
    return { maxPerSecond: 1000, maxPerMinute: 60000, windowMs: 1000 };
  }

  private async scheduleStatus(
    channel: Channel,
    externalMessageId: string,
    status: 'delivered' | 'read',
    delay: number,
  ): Promise<void> {
    await this.inboundQueue.add(
      'process-status',
      {
        channelId: channel.id,
        organizationId: channel.organizationId,
        status: { externalMessageId, status, timestamp: new Date() },
      },
      { delay, attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true, removeOnFail: false },
    );
  }
}
