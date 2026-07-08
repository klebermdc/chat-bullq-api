import { Injectable } from '@nestjs/common';
import { InactivitySettings, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class InactivitySettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(organizationId: string): Promise<InactivitySettings | null> {
    return this.prisma.inactivitySettings.findUnique({ where: { organizationId } });
  }

  upsert(
    organizationId: string,
    data: Prisma.InactivitySettingsUncheckedUpdateInput & Prisma.InactivitySettingsUncheckedCreateInput,
  ): Promise<InactivitySettings> {
    return this.prisma.inactivitySettings.upsert({
      where: { organizationId },
      create: { ...data, organizationId },
      update: data,
    });
  }

  /** Orgs com detecção ligada (para o watchdog varrer). */
  listEnabledOrgIds(): Promise<{ organizationId: string }[]> {
    return this.prisma.inactivitySettings.findMany({
      where: { enabled: true },
      select: { organizationId: true },
    });
  }
}
