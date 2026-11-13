import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { randomInt, randomUUID } from 'crypto';
import { Queue } from 'bullmq';
import { Channel, ChannelType } from '@prisma/client';
import { OutboundChannelPort } from '../../channel-hub/ports/outbound-channel.port';
import { PrismaService } from '../../../database/prisma.service';
import { BOT_READ_DELAY_MAX_MS, BOT_READ_DELAY_MIN_MS, BOT_TURN_JOB, botTurnJobId } from '../bot/bot.constants';
import { MYSTERY_SHOPPER_QUEUE } from '../mystery-shopper.constants';
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

  private readonly logger = new Logger(SimulatedOutboundAdapter.name);

  constructor(
    @InjectQueue('inbound-messages') private readonly inboundQueue: Queue,
    @InjectQueue(MYSTERY_SHOPPER_QUEUE) private readonly botQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  async sendMessage(
    channel: Channel,
    contactExternalId: string,
    _message: NormalizedOutboundMessage,
  ): Promise<SendResult> {
    const externalId = `sim.out.${randomUUID().replace(/-/g, '')}`;
    await this.scheduleStatus(channel, externalId, 'delivered', SIMULATED_DELIVERED_DELAY_MS);
    await this.scheduleStatus(channel, externalId, 'read', SIMULATED_READ_DELAY_MS);
    // Sem await: acordar o robô nunca atrasa nem derruba o envio.
    void this.wakeBot(channel, contactExternalId);
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

  /**
   * Se há um robô de cliente oculto vivo para este contato simulado, agenda o turno dele
   * com a espera de leitura. Debounce: cada mensagem nova da equipe recomeça a espera.
   */
  private async wakeBot(channel: Channel, contactExternalId: string): Promise<void> {
    try {
      const run = await this.prisma.mysteryShopperBotRun.findFirst({
        where: {
          organizationId: channel.organizationId,
          status: { in: ['ACTIVE', 'CLOSING'] },
          number: { isSimulated: true, channelId: channel.id, contact: { phone: contactExternalId } },
        },
        select: { id: true },
      });
      if (!run) return;
      const jobId = botTurnJobId(run.id);
      await this.removePendingTurn(jobId);
      await this.botQueue.add(
        BOT_TURN_JOB,
        { runId: run.id },
        {
          jobId,
          delay: randomInt(BOT_READ_DELAY_MIN_MS, BOT_READ_DELAY_MAX_MS + 1),
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    } catch (err) {
      this.logger.warn(`bot_wake_failed channel=${channel.id}: ${(err as Error).message}`);
    }
  }

  private async removePendingTurn(jobId: string): Promise<void> {
    try {
      const job = await this.botQueue.getJob(jobId);
      await job?.remove();
    } catch (err) {
      // Turno já em execução não se remove: o novo agendamento (se aceito) cobre a mensagem seguinte.
      this.logger.warn(`bot_wake_remove_failed job=${jobId}: ${(err as Error).message}`);
    }
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
        status: { externalMessageId, status, timestamp: new Date(Date.now() + delay) },
      },
      { delay, attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true, removeOnFail: false },
    );
  }
}
