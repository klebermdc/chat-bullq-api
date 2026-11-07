import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { phoneVariants } from '../../common/utils/phone.util';
import { PrismaService } from '../../database/prisma.service';
import { IdempotencyService } from '../messaging/pipeline/idempotency.service';
import { LeadCardService } from '../messaging/pipeline/lead-card.service';
import { buildAttribution, classifyForm, WebsiteFormKind } from './website-lead-attribution';
import { parseWebsiteLeadPayload, ParsedWebsiteLead } from './website-lead-payload';
import { WebsiteLeadSettingsService } from './website-lead-settings.service';
import { tagContact } from './website-lead-tags';
import { detectSpam, normalizeLeadPhone } from './website-lead-validation';
import {
  DEDUPE_WINDOW_MS,
  GUIAMENTO_TAG,
  SITE_TAG,
  WEBSITE_LEAD_FOLLOWUP_JOB,
  WEBSITE_LEAD_FOLLOWUP_QUEUE,
} from './website-leads.constants';

const MINUTE_MS = 60_000;

export interface IntakeRequest {
  token: string | null | undefined;
  body: unknown;
  /** `?form=guiamento` na URL do webhook (o formato simples não traz o form). */
  formOverride?: string | null;
}

export type IntakeResult =
  | { accepted: true; duplicate: boolean; submissionId: string; followup: 'scheduled' | 'off' }
  | { accepted: false; reason: string };

/**
 * Entrada do lead do formulário do site. Grava contato, atribuição, histórico
 * de envio, etiquetas e card; agenda o retorno automático. Não envia nada.
 */
@Injectable()
export class WebsiteLeadIntakeService {
  private readonly logger = new Logger(WebsiteLeadIntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: WebsiteLeadSettingsService,
    private readonly idempotency: IdempotencyService,
    private readonly leadCard: LeadCardService,
    @InjectQueue(WEBSITE_LEAD_FOLLOWUP_QUEUE) private readonly followupQueue: Queue,
  ) {}

  async ingest(req: IntakeRequest, now: Date = new Date()): Promise<IntakeResult> {
    const config = await this.settings.findByToken(req.token);
    if (!config) throw new UnauthorizedException('Token inválido.');
    const organizationId = config.organizationId;

    const parsed = parseWebsiteLeadPayload(req.body);
    const phone = normalizeLeadPhone(parsed.phoneRaw);
    if (!phone) throw new BadRequestException('Telefone ausente ou inválido.');

    const spam = detectSpam({ name: parsed.name, email: parsed.email, phone });
    if (spam) {
      this.logger.warn(`lead do site descartado como spam (${spam}) org=${organizationId}`);
      return { accepted: false, reason: 'spam' };
    }

    const formKind = classifyForm(parsed, req.formOverride);
    const attribution = { ...buildAttribution(parsed, now), form_kind: formKind };
    const dedupeKey = this.dedupeKey(formKind, phone, parsed);

    return this.idempotency.withLock(`lead-site:${organizationId}:${dedupeKey}`, async () => {
      const duplicate = await this.prisma.leadSubmission.findFirst({
        where: {
          organizationId,
          dedupeKey,
          createdAt: { gte: new Date(now.getTime() - DEDUPE_WINDOW_MS) },
        },
        select: { id: true, followupStatus: true },
      });
      if (duplicate) {
        return {
          accepted: true as const,
          duplicate: true,
          submissionId: duplicate.id,
          followup: duplicate.followupStatus === 'PENDING' ? ('scheduled' as const) : ('off' as const),
        };
      }

      const contactId = await this.upsertContact(organizationId, config.channelId, phone, parsed, attribution);
      const followupOn = config.enabled && !!config.channelId && !!config.templateId;
      const submission = await this.prisma.leadSubmission.create({
        data: {
          organizationId,
          contactId,
          formKind,
          formId: parsed.formId,
          formName: parsed.formName,
          dedupeKey,
          phone,
          raw: parsed as unknown as Prisma.InputJsonValue,
          attribution: attribution as unknown as Prisma.InputJsonValue,
          followupStatus: followupOn ? 'PENDING' : 'SKIPPED',
          followupReason: followupOn ? null : 'disabled',
          followupScheduledAt: followupOn
            ? new Date(now.getTime() + config.delayMinutes * MINUTE_MS)
            : null,
        },
      });

      await this.decorate(organizationId, contactId, formKind);
      if (followupOn) {
        await this.followupQueue.add(
          WEBSITE_LEAD_FOLLOWUP_JOB,
          { submissionId: submission.id },
          {
            jobId: `lead-site-${submission.id}`,
            delay: config.delayMinutes * MINUTE_MS,
            attempts: 3,
            backoff: { type: 'exponential', delay: 30_000 },
            removeOnComplete: true,
            removeOnFail: 100,
          },
        );
      }
      this.logger.log(
        `lead do site recebido: sub=${submission.id} contato=${contactId} form=${formKind} retorno=${followupOn ? 'agendado' : 'desligado'}`,
      );
      return {
        accepted: true as const,
        duplicate: false,
        submissionId: submission.id,
        followup: followupOn ? ('scheduled' as const) : ('off' as const),
      };
    });
  }

  private dedupeKey(formKind: WebsiteFormKind, phone: string, p: ParsedWebsiteLead): string {
    const parts = [formKind, phone, p.email?.toLowerCase(), p.name?.toLowerCase(), p.pageUrl];
    return createHash('sha256').update(parts.map((x) => x ?? '').join('|')).digest('hex');
  }

  /**
   * Acha o contato como o WhatsApp acharia: primeiro pelo vínculo do canal
   * (com e sem o 9º dígito), depois pelo telefone — assim o contato que veio
   * da Umbler não é duplicado. Só cria se não houver nenhum.
   */
  private async upsertContact(
    organizationId: string,
    channelId: string | null,
    phone: string,
    parsed: ParsedWebsiteLead,
    attribution: Record<string, unknown>,
  ): Promise<string> {
    const variants = phoneVariants(phone);
    const viaChannel = channelId
      ? await this.prisma.contactChannel.findFirst({
          where: {
            channelId,
            externalId: { in: variants },
            contact: { organizationId, deletedAt: null },
          },
          select: { contactId: true },
        })
      : null;
    const existing = await this.prisma.contact.findFirst({
      where: viaChannel
        ? { id: viaChannel.contactId }
        : { organizationId, phone: { in: variants }, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, email: true, metadata: true },
    });

    if (!existing) {
      const created = await this.prisma.contact.create({
        data: {
          organizationId,
          phone,
          name: parsed.name,
          email: parsed.email,
          metadata: { attribution } as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      return created.id;
    }

    const metadata = (existing.metadata ?? {}) as Record<string, unknown>;
    await this.prisma.contact.update({
      where: { id: existing.id },
      data: {
        ...(existing.name ? {} : { name: parsed.name }),
        ...(existing.email ? {} : { email: parsed.email }),
        metadata: { ...metadata, attribution } as Prisma.InputJsonValue,
      },
    });
    return existing.id;
  }

  /** Etiquetas e card são enfeite: falha só loga, o envio já está gravado. */
  private async decorate(organizationId: string, contactId: string, formKind: WebsiteFormKind) {
    const tags = formKind === 'guiamento' ? [SITE_TAG, GUIAMENTO_TAG] : [SITE_TAG];
    await tagContact(this.prisma, organizationId, contactId, tags).catch((err: Error) =>
      this.logger.warn(`lead do site: etiqueta falhou contato=${contactId}: ${err.message}`),
    );
    await this.leadCard.ensureContactLeadCard({ organizationId, contactId });
  }
}
