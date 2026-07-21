import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createHash } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { MetaCapiService } from './meta-capi.service';
import { MetaCapiHttpClient } from './meta-capi.http-client';
import { PurchaseJobData } from './meta-capi.queue';
import {
  META_CAPI_QUEUE,
  CTWA_ATTRIBUTION_WINDOW_DAYS,
} from './meta-capi.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

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
          select: { phone: true, ctwaClid: true, ctwaClidAt: true },
        },
      },
    });
    if (!card || card.organizationId !== organizationId) return;

    const value = card.value != null ? Number(card.value) : 0;
    const currency = card.currency || 'BRL';

    const userData = this.buildUserData(card.contact);
    if (Object.keys(userData).length === 0) {
      // Sem ctwa_clid válido e sem telefone → não há como atribuir.
      await this.record(eventId, organizationId, cardId, 'SKIPPED', value, currency, {
        reason: 'no_match_data',
      });
      return;
    }

    const eventTime = Math.floor(
      (card.closedAt?.getTime() ?? Date.now()) / 1000,
    );

    const result = await this.http.sendEvents({
      datasetId: cfg.datasetId,
      token: cfg.token,
      testEventCode: cfg.testEventCode,
      data: [
        {
          event_name: 'Purchase',
          event_time: eventTime,
          action_source: 'business_messaging',
          messaging_channel: 'whatsapp',
          event_id: eventId,
          user_data: userData,
          custom_data: { value, currency },
        },
      ],
    });

    if (!result.ok) {
      await this.record(eventId, organizationId, cardId, 'FAILED', value, currency, result.body);
      // Lança pra BullMQ retentar (attempts/backoff da fila).
      throw new Error(`CAPI send failed status=${result.status}`);
    }

    await this.record(eventId, organizationId, cardId, 'SENT', value, currency, result.body);
    this.logger.log(`Purchase enviado card=${cardId} value=${value} ${currency}`);
  }

  /** Monta user_data com ctwa_clid (dentro da janela) + hash do telefone. */
  private buildUserData(
    contact: { phone: string | null; ctwaClid: string | null; ctwaClidAt: Date | null } | null,
  ): Record<string, any> {
    const ud: Record<string, any> = {};
    if (!contact) return ud;

    if (contact.ctwaClid && this.withinWindow(contact.ctwaClidAt)) {
      ud.ctwa_clid = contact.ctwaClid;
    }
    const ph = this.hashPhone(contact.phone);
    if (ph) ud.ph = [ph];

    return ud;
  }

  private withinWindow(clidAt: Date | null): boolean {
    if (!clidAt) return false;
    const ageDays = (Date.now() - clidAt.getTime()) / DAY_MS;
    return ageDays <= CTWA_ATTRIBUTION_WINDOW_DAYS;
  }

  /** SHA-256 do telefone em E.164 sem '+', só dígitos (requisito da Meta). */
  private hashPhone(phone: string | null): string | null {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (!digits) return null;
    return createHash('sha256').update(digits).digest('hex');
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
