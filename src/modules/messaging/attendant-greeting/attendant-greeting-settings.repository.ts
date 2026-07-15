import { Injectable } from '@nestjs/common';
import { AttendantGreetingSettings, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class AttendantGreetingSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(organizationId: string): Promise<AttendantGreetingSettings | null> {
    return this.prisma.attendantGreetingSettings.findUnique({
      where: { organizationId },
    });
  }

  upsert(
    organizationId: string,
    data: Prisma.AttendantGreetingSettingsUncheckedUpdateInput &
      Prisma.AttendantGreetingSettingsUncheckedCreateInput,
  ): Promise<AttendantGreetingSettings> {
    return this.prisma.attendantGreetingSettings.upsert({
      where: { organizationId },
      create: { ...data, organizationId },
      update: data,
    });
  }
}
