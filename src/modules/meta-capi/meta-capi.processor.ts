import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../database/prisma.service';
import { MetaCapiService } from './meta-capi.service';
import { MetaCapiHttpClient } from './meta-capi.http-client';
import { PurchaseJobData } from './meta-capi.queue';
import { META_CAPI_QUEUE } from './meta-capi.constants';
import { buildPurchaseEvent } from './meta-capi.event-builder';

@Processor(META_CAPI_QUEUE, { concurrency: 5 })
export class MetaCapiProcessor extends WorkerHost {
  private readonly logger = new Logger(MetaCapiProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: MetaCapiService,
    private readonly http: MetaCapiHttpClient,
  ) {
    super();
  }

  async process(job: Job<PurchaseJobData>): Promise<void> {
    const { cardId, organizationId } = job.data;
    const eventId = `${cardId}:won`;

    // Idempotência: já enviado com sucesso → nada a fazer.
    const prior = await this.prisma.metaCapiEvent.findUnique({
      where: { eventId },
      select: { status: true },
    });
    if (prior?.status === 'SENT') return;

    // Org sem config ou desligada → sai sem gravar (sem ruído).
    const cfg = await this.config.resolveConfig(organizationId);
    if (!cfg) return;

    const card = await this.prisma.card.findUnique({
      where: { id: cardId },
      include: {
        contact: {
          select: { id: true, phone: true, email: true, ctwaClid: true, ctwaClidAt: true },
        },
        conversation: { select: { channel: { select: { config: true } } } },
      },
    });
    if (!card || card.organizationId !== organizationId) return;

    const value = card.value != null ? Number(card.value) : 0;
    const currency = card.currency || 'BRL';
    const closedAt = card.closedAt ?? new Date();

    const built = buildPurchaseEvent({
      eventId,
      eventTime: Math.floor(closedAt.getTime() / 1000),
      value,
      currency,
      now: closedAt,
      contact: card.contact,
      wabaId: this.wabaOf(card.conversation?.channel?.config),
      pageId: cfg.pageId,
      siteLead: card.contact ? await this.lastSiteLead(card.contact.id, closedAt) : null,
    });
    if (!built.ok) {
      await this.record(eventId, organizationId, cardId, 'SKIPPED', value, currency, {
        reason: built.reason,
      });
      return;
    }

    const result = await this.http.sendEvents({
      datasetId: cfg.datasetId,
      token: cfg.token,
      testEventCode: cfg.testEventCode,
      data: [built.event],
    });

    if (!result.ok) {
      await this.record(eventId, organizationId, cardId, 'FAILED', value, currency, result.body);
      // Lança pra BullMQ retentar (attempts/backoff da fila).
      throw new Error(`CAPI send failed status=${result.status}`);
    }

    await this.record(eventId, organizationId, cardId, 'SENT', value, currency, result.body);
    this.logger.log(`Purchase enviado card=${cardId} value=${value} ${currency}`);
  }

  /** WABA do canal oficial da conversa (config.businessAccountId). */
  private wabaOf(config: unknown): string | null {
    const id = (config as Record<string, unknown> | null)?.businessAccountId;
    return typeof id === 'string' && id ? id : null;
  }

  /** Último formulário do site do contato antes da venda. */
  private async lastSiteLead(contactId: string, before: Date) {
    const sub = await this.prisma.leadSubmission.findFirst({
      where: { contactId, createdAt: { lte: before } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, attribution: true },
    });
    if (!sub) return null;
    const a = (sub.attribution ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return {
      submittedAt: sub.createdAt,
      fbclid: str(a.fbclid),
      pageUrl: str(a.page_url),
      ip: str(a.ip),
      userAgent: str(a.user_agent),
    };
  }

  private async record(
    eventId: string,
    organizationId: string,
    cardId: string,
    status: 'SENT' | 'FAILED' | 'SKIPPED',
    value: number,
    currency: string,
    responsePayload: unknown,
  ): Promise<void> {
    await this.prisma.metaCapiEvent.upsert({
      where: { eventId },
      create: {
        eventId,
        organizationId,
        cardId,
        status,
        value,
        currency,
        responsePayload: responsePayload as any,
      },
      update: { status, responsePayload: responsePayload as any },
    });
  }
}
