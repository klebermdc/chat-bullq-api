import { Injectable } from '@nestjs/common';
import { EmailMessageStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

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
  constructor(private readonly prisma: PrismaService) {}

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
