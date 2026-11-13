import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { isViewer, readMysteryShopperSettings } from './mystery-shopper.config';
import type { MysteryShopperSettings } from './mystery-shopper.types';

/**
 * Quem pode ver o cliente oculto. Quem não pode recebe 404 (não 403), para
 * nem saber que a página existe — vale também para ADMIN e OWNER.
 */
@Injectable()
export class MysteryShopperAccess {
  constructor(private readonly prisma: PrismaService) {}

  async settings(organizationId: string): Promise<MysteryShopperSettings> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    return readMysteryShopperSettings(org?.settings);
  }

  async isAllowed(organizationId: string, email: string | null | undefined): Promise<boolean> {
    return isViewer(await this.settings(organizationId), email);
  }

  async assertViewer(organizationId: string, email: string | null | undefined): Promise<void> {
    if (!(await this.isAllowed(organizationId, email))) throw new NotFoundException();
  }
}
