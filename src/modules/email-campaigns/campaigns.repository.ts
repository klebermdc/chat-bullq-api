import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class CampaignsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string, organizationId: string) {
    return this.prisma.emailCampaign.findFirst({ where: { id, organizationId } });
  }

  create(data: Prisma.EmailCampaignUncheckedCreateInput) {
    return this.prisma.emailCampaign.create({ data });
  }

  update(id: string, data: Prisma.EmailCampaignUncheckedUpdateInput) {
    return this.prisma.emailCampaign.update({ where: { id }, data });
  }

  list(organizationId: string, skip = 0, take = 20) {
    return this.prisma.$transaction([
      this.prisma.emailCampaign.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.emailCampaign.count({ where: { organizationId } }),
    ]);
  }
}
