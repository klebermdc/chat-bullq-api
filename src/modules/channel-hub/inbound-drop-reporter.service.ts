import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChannelType, NotificationType, OrgRole } from '@prisma/client';
import type Redis from 'ioredis';
import { WebhookEventsService } from './webhook-events.service';
import { NotificationsService } from '../notifications/notifications.service';

export const INBOUND_DROP_REDIS = 'INBOUND_DROP_REDIS';

export enum InboundDropReason {
  NO_LOCATORS = 'NO_LOCATORS',
  CHANNEL_INACTIVE = 'CHANNEL_INACTIVE',
  UNKNOWN_LOCATOR = 'UNKNOWN_LOCATOR',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
}

export interface DropChannel {
  id: string;
  name: string;
  organizationId: string;
}

/** Um alerta por canal+motivo a cada 15 min. Canal caído gera centenas de
 *  webhooks — sem isso o OWNER receberia centenas de notificações. */
const ALERT_TTL_SECONDS = 15 * 60;

/**
 * Ponto único de relato de inbound descartado.
 *
 * NUNCA lança: uma falha ao relatar um descarte não pode derrubar o webhook e
 * transformar uma mensagem perdida em todas as mensagens perdidas.
 */
@Injectable()
export class InboundDropReporter {
  private readonly logger = new Logger(InboundDropReporter.name);

  constructor(
    private readonly webhookEvents: WebhookEventsService,
    private readonly notifications: NotificationsService,
    @Inject(INBOUND_DROP_REDIS) private readonly redis: Redis,
  ) {}

  async reportDrop(params: {
    channelType: ChannelType;
    reason: InboundDropReason;
    payload: unknown;
    headers: Record<string, string>;
    channel?: DropChannel | null;
  }): Promise<void> {
    const { channelType, reason, payload, headers, channel } = params;
    const context = channel
      ? `canal ${channel.name} (${channel.id})`
      : 'canal não identificado';

    this.logger.warn(`Inbound descartado [${reason}] ${channelType}: ${context}`);

    try {
      await this.webhookEvents.recordDropped({
        channelType,
        reason: `${reason}: ${context}`,
        payload,
        headers,
        channelId: channel?.id ?? null,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao persistir drop ${reason}: ${msg}`);
    }

    // Sem canal não há organizationId — não existe a quem notificar.
    if (!channel) return;

    const alert = this.buildAlert(reason, channel);
    if (!alert) return;

    // Se o Redis estiver fora, o slot nunca é conquistado e o alerta é
    // silenciosamente perdido (não reenviado) — trade-off deliberado: preferimos
    // perder um alerta a transformar uma queda do Redis em tempestade de notificação.
    try {
      const slot = await this.redis.set(
        `chdrop:${channelType}:${reason}:${channel.id}`,
        '1',
        'EX',
        ALERT_TTL_SECONDS,
        'NX',
      );
      if (slot !== 'OK') return; // já alertado dentro da janela

      await this.notifications.notifyOrgAgents({
        organizationId: channel.organizationId,
        roles: [OrgRole.OWNER],
        type: NotificationType.SYSTEM,
        title: alert.title,
        body: alert.body,
        data: { channelId: channel.id, channelType, reason },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Falha ao alertar drop ${reason}: ${msg}`);
    }
  }

  private buildAlert(
    reason: InboundDropReason,
    channel: DropChannel,
  ): { title: string; body: string } | null {
    switch (reason) {
      case InboundDropReason.CHANNEL_INACTIVE:
        return {
          title: 'Canal desativado está perdendo mensagens',
          body: `O canal "${channel.name}" está desativado e mensagens de clientes estão sendo descartadas. Reative o canal para voltar a receber.`,
        };
      case InboundDropReason.INVALID_SIGNATURE:
        return {
          title: 'Webhook com assinatura inválida',
          body: `O canal "${channel.name}" recebeu um webhook com assinatura inválida e a mensagem foi descartada. Verifique se o token do provedor foi trocado.`,
        };
      default:
        return null;
    }
  }
}
