import { Injectable } from '@nestjs/common';
import { InactivitySettings } from '@prisma/client';
import { InactivitySettingsRepository } from './inactivity-settings.repository';
import { UpdateInactivitySettingsDto } from './dto/update-inactivity-settings.dto';
import type { BandsUnit } from './inactivity.util';

export const DEFAULT_INACTIVITY_SETTINGS = {
  enabled: true,
  bandsDays: [3, 7, 15, 30] as number[],
  bandsUnit: 'DAYS' as BandsUnit,
  autoReengage: false,
  reengageFromBand: 1,
  maxAttempts: 2,
  retryEveryHours: 48,
  quietHoursStart: null as number | null,
  quietHoursEnd: null as number | null,
  reengageOnlyAiParked: false,
};

export type ResolvedInactivitySettings = typeof DEFAULT_INACTIVITY_SETTINGS & {
  organizationId: string;
};

@Injectable()
export class InactivitySettingsService {
  constructor(private readonly repo: InactivitySettingsRepository) {}

  async get(organizationId: string): Promise<ResolvedInactivitySettings> {
    const row = await this.repo.find(organizationId);
    return {
      organizationId,
      ...DEFAULT_INACTIVITY_SETTINGS,
      ...(row
        ? {
            enabled: row.enabled,
            bandsDays: row.bandsDays as number[],
            bandsUnit: row.bandsUnit as BandsUnit,
            autoReengage: row.autoReengage,
            reengageFromBand: row.reengageFromBand,
            maxAttempts: row.maxAttempts,
            retryEveryHours: row.retryEveryHours,
            quietHoursStart: row.quietHoursStart,
            quietHoursEnd: row.quietHoursEnd,
            reengageOnlyAiParked: row.reengageOnlyAiParked,
          }
        : {}),
    };
  }

  async update(
    organizationId: string,
    dto: UpdateInactivitySettingsDto,
  ): Promise<InactivitySettings> {
    const data: any = { ...dto };
    if (dto.bandsDays) data.bandsDays = [...dto.bandsDays].sort((a, b) => a - b);
    return this.repo.upsert(organizationId, data);
  }
}
