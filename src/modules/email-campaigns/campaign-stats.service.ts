import { BadRequestException, Injectable } from '@nestjs/common';
import { EmailMessageStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SubscribersRepository } from '../email-audience/subscribers.repository';
import { AudienceFilter, buildAudienceWhere, parseAudienceFilter } from '../email-audience/audience-filter';
import { CampaignsService } from './campaigns.service';

export interface AudienceCountResult {
  count: number;
  filter: AudienceFilter;
}

export interface CampaignStats {
  total: number;
  pending: number;
  sent: number;
  delivered: number;
  bounced: number;
  complained: number;
  failed: number;
  opened: number;
  clicked: number;
}

@Injectable()
export class CampaignStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly subscribersRepo: SubscribersRepository,
  ) {}

  async forCampaign(campaignId: string, organizationId: string): Promise<CampaignStats> {
    const [byStatus, opened, clicked, total] = await Promise.all([
      this.prisma.emailMessage.groupBy({
        by: ['status'],
        where: { campaignId, organizationId },
        _count: { _all: true },
      }),
      this.prisma.emailMessage.count({
        where: { campaignId, organizationId, openCount: { gt: 0 } },
      }),
      this.prisma.emailMessage.count({
        where: { campaignId, organizationId, clickCount: { gt: 0 } },
      }),
      this.prisma.emailMessage.count({ where: { campaignId, organizationId } }),
    ]);

    const count = (s: EmailMessageStatus) => byStatus.find((r) => r.status === s)?._count._all ?? 0;

    return {
      total,
      pending: count(EmailMessageStatus.PENDING),
      sent: count(EmailMessageStatus.SENT),
      delivered: count(EmailMessageStatus.DELIVERED),
      bounced: count(EmailMessageStatus.BOUNCED),
      complained: count(EmailMessageStatus.COMPLAINED),
      failed: count(EmailMessageStatus.FAILED),
      opened,
      clicked,
    };
  }

  /**
   * Contagem do público antes do disparo. Usa a MESMA `buildAudienceWhere`
   * que `CampaignDispatchService.dispatch` usa por baixo dos panos — nunca
   * uma segunda consulta, ou o número mostrado na tela pode divergir do que
   * de fato sai no envio.
   *
   * Aceita um filtro por fora (`filterOverride`) para a tela contar
   * enquanto o operador monta os critérios, antes de salvar a campanha.
   * Sem filtro por fora, usa o `audienceFilter` já gravado na campanha.
   */
  async audienceCount(
    campaignId: string,
    organizationId: string,
    filterOverride?: unknown,
  ): Promise<AudienceCountResult> {
    const campaign = await this.campaigns.findOne(campaignId, organizationId);
    const rawFilter = filterOverride !== undefined ? filterOverride : campaign.audienceFilter;

    let filter: AudienceFilter;
    try {
      filter = parseAudienceFilter(rawFilter);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }

    const where = buildAudienceWhere(organizationId, filter);
    const count = await this.subscribersRepo.countByWhere(where);
    return { count, filter };
  }

  /** Falhas com o motivo real do provedor. É o que torna o erro depurável. */
  failures(campaignId: string, organizationId: string) {
    return this.prisma.emailMessage.findMany({
      where: {
        campaignId,
        organizationId,
        status: { in: [EmailMessageStatus.FAILED, EmailMessageStatus.BOUNCED] },
      },
      select: { to: true, status: true, failedReason: true },
      take: 100,
    });
  }
}
