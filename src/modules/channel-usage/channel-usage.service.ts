import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { StatusUpdate } from '../channel-hub/ports/types';

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ChannelUsageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra (upsert) a janela de 24h a partir do status da Meta.
   * Idempotente pela chave única (channelId, metaConversationId).
   * No update, só grava category/billable/pricingModel quando o payload de
   * entrada os traz de fato — o `origin`/`pricing` costuma vir só no 1º status.
   * Assim um status posterior sem esses dados NÃO regride uma categoria boa
   * para "unknown" nem re-seta o billable no default.
   */
  async recordWindow(
    organizationId: string,
    channelId: string,
    status: StatusUpdate,
  ): Promise<void> {
    const conv = status.conversation;
    if (!conv?.id) return;

    const category = status.pricing?.category || conv.originType || 'unknown';
    const billable = status.pricing?.billable ?? true;
    const pricingModel = status.pricing?.pricingModel ?? null;
    const expirationAt = conv.expirationTimestamp
      ? new Date(conv.expirationTimestamp * 1000)
      : null;
    const openedAt = expirationAt
      ? new Date(expirationAt.getTime() - DAY_MS)
      : status.timestamp;

    const update: Record<string, any> = {};
    if (category !== 'unknown') update.category = category;
    if (status.pricing?.billable != null) update.billable = billable;
    if (pricingModel != null) update.pricingModel = pricingModel;
    if (expirationAt) update.expirationAt = expirationAt;

    await this.prisma.whatsappWindow.upsert({
      where: {
        uq_window_channel_conv: { channelId, metaConversationId: conv.id },
      },
      create: {
        organizationId,
        channelId,
        metaConversationId: conv.id,
        category,
        billable,
        pricingModel,
        openedAt,
        expirationAt,
      },
      update,
    });
  }
}
