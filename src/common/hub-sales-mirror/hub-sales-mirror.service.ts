import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { HUB_SALES_MIRROR_SETTING, hasHubSalesMirror } from './hub-sales-mirror.rules';

/** Quem pode ler o espelho de pedidos do HUB. Ver hub-sales-mirror.rules.ts. */
@Injectable()
export class HubSalesMirrorAccess {
  constructor(private readonly prisma: PrismaService) {}

  async isEnabledFor(organizationId: string): Promise<boolean> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    return hasHubSalesMirror(org?.settings);
  }

  /** Orgs donas do HUB — usado pelas rotinas sem requisição (sync, correlação). */
  async ownerOrgIds(): Promise<string[]> {
    const orgs = await this.prisma.organization.findMany({
      where: { settings: { path: [HUB_SALES_MIRROR_SETTING], equals: true } },
      select: { id: true },
    });
    return orgs.map((o) => o.id);
  }
}
