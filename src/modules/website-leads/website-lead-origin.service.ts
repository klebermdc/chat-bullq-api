import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

const SUBMISSIONS_SHOWN = 10;

interface AdNames {
  campaignName: string | null;
  adsetName: string | null;
  adName: string | null;
}

export interface ContactOriginView {
  /** Último envio do site (contact.metadata.attribution), com nomes da Meta. */
  site: (Record<string, unknown> & AdNames) | null;
  /** Clique em anúncio Click-to-WhatsApp gravado no contato. */
  ctwa: { sourceId: string | null; sourceType: string | null; at: Date | null; adName: string | null; campaignName: string | null } | null;
  submissions: {
    id: string;
    createdAt: Date;
    formKind: string;
    followupStatus: string;
    followupReason: string | null;
    source: string | null;
    medium: string | null;
    campaign: string | null;
  }[];
}

/**
 * Bloco "Origem" do painel do contato/card. Na Meta, `utm_campaign`,
 * `utm_term` e `utm_content` levam os IDs de campanha, conjunto e anúncio —
 * cruzamos com `ad_daily_stats` para mostrar os nomes quando houver.
 */
@Injectable()
export class WebsiteLeadOriginService {
  constructor(private readonly prisma: PrismaService) {}

  async forContact(organizationId: string, contactId: string): Promise<ContactOriginView> {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, organizationId, deletedAt: null },
      select: { metadata: true, ctwaSourceId: true, ctwaSourceType: true, ctwaClidAt: true },
    });
    if (!contact) throw new NotFoundException('Contato não encontrado.');

    const attribution = ((contact.metadata ?? {}) as Record<string, any>).attribution as
      | Record<string, unknown>
      | undefined;
    const [siteNames, ctwaAd, submissions] = await Promise.all([
      attribution ? this.namesFor(organizationId, attribution) : null,
      contact.ctwaSourceId ? this.adById(organizationId, contact.ctwaSourceId) : null,
      this.prisma.leadSubmission.findMany({
        where: { organizationId, contactId },
        orderBy: { createdAt: 'desc' },
        take: SUBMISSIONS_SHOWN,
        select: {
          id: true,
          createdAt: true,
          formKind: true,
          followupStatus: true,
          followupReason: true,
          attribution: true,
        },
      }),
    ]);

    return {
      site: attribution ? { ...attribution, ...(siteNames as AdNames) } : null,
      ctwa: contact.ctwaSourceId || contact.ctwaClidAt
        ? {
            sourceId: contact.ctwaSourceId,
            sourceType: contact.ctwaSourceType,
            at: contact.ctwaClidAt,
            adName: ctwaAd?.adName ?? null,
            campaignName: ctwaAd?.campaignName ?? null,
          }
        : null,
      submissions: submissions.map((s) => {
        const a = (s.attribution ?? {}) as Record<string, any>;
        return {
          id: s.id,
          createdAt: s.createdAt,
          formKind: s.formKind,
          followupStatus: s.followupStatus,
          followupReason: s.followupReason,
          source: a.utm_source ?? a.ofp_src ?? null,
          medium: a.utm_medium ?? a.ofp_mdm ?? null,
          campaign: a.utm_campaign ?? a.ofp_cmp ?? null,
        };
      }),
    };
  }

  private async namesFor(organizationId: string, a: Record<string, unknown>): Promise<AdNames> {
    const str = (v: unknown) => (typeof v === 'string' && /^\d{6,}$/.test(v) ? v : null);
    const adId = str(a.utm_content);
    const adsetId = str(a.utm_term);
    const campaignId = str(a.utm_campaign) ?? str(a.utm_id);
    const [byAd, byAdset, byCampaign] = await Promise.all([
      adId ? this.adById(organizationId, adId) : null,
      adsetId
        ? this.prisma.adDailyStat.findFirst({
            where: { organizationId, adsetId },
            orderBy: { date: 'desc' },
            select: { adsetName: true, campaignName: true },
          })
        : null,
      campaignId
        ? this.prisma.adDailyStat.findFirst({
            where: { organizationId, campaignId },
            orderBy: { date: 'desc' },
            select: { campaignName: true },
          })
        : null,
    ]);
    return {
      campaignName: byCampaign?.campaignName ?? byAdset?.campaignName ?? byAd?.campaignName ?? null,
      adsetName: byAdset?.adsetName ?? byAd?.adsetName ?? null,
      adName: byAd?.adName ?? null,
    };
  }

  private adById(organizationId: string, adId: string) {
    return this.prisma.adDailyStat.findFirst({
      where: { organizationId, adId },
      orderBy: { date: 'desc' },
      select: { adName: true, adsetName: true, campaignName: true },
    });
  }
}
