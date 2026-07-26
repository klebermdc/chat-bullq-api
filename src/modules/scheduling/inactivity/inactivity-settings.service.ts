import { Injectable } from '@nestjs/common';
import { InactivitySettings } from '@prisma/client';
import { InactivitySettingsRepository } from './inactivity-settings.repository';
import { UpdateInactivitySettingsDto } from './dto/update-inactivity-settings.dto';
import { bandHours, type BandsUnit } from './inactivity.util';

export const DEFAULT_INACTIVITY_SETTINGS = {
  enabled: true,
  bandsDays: [3, 7, 15, 30] as number[],
  // Unidade POR FAIXA, paralela a bandsDays. Vazio/curto → completa com DAYS.
  bandsUnits: ['DAYS', 'DAYS', 'DAYS', 'DAYS'] as BandsUnit[],
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

/**
 * Resolve a unidade de cada faixa: usa `bands_units` se houver, senão cai no
 * `bands_unit` global antigo (legado), senão 'DAYS'. Sempre com o mesmo
 * comprimento de `bandsDays`.
 */
function resolveUnits(
  bandsDays: number[],
  stored: string[] | null | undefined,
  legacyGlobal: string | null | undefined,
): BandsUnit[] {
  const fallback: BandsUnit = legacyGlobal === 'HOURS' ? 'HOURS' : 'DAYS';
  return bandsDays.map((_, i) => {
    const u = stored?.[i];
    return u === 'HOURS' || u === 'DAYS' ? (u as BandsUnit) : fallback;
  });
}

@Injectable()
export class InactivitySettingsService {
  constructor(private readonly repo: InactivitySettingsRepository) {}

  async get(organizationId: string): Promise<ResolvedInactivitySettings> {
    const row = await this.repo.find(organizationId);
    if (!row) return { organizationId, ...DEFAULT_INACTIVITY_SETTINGS };
    const bandsDays = row.bandsDays as number[];
    return {
      organizationId,
      ...DEFAULT_INACTIVITY_SETTINGS,
      enabled: row.enabled,
      bandsDays,
      bandsUnits: resolveUnits(bandsDays, row.bandsUnits, row.bandsUnit),
      autoReengage: row.autoReengage,
      reengageFromBand: row.reengageFromBand,
      maxAttempts: row.maxAttempts,
      retryEveryHours: row.retryEveryHours,
      quietHoursStart: row.quietHoursStart,
      quietHoursEnd: row.quietHoursEnd,
      reengageOnlyAiParked: row.reengageOnlyAiParked,
    };
  }

  async update(
    organizationId: string,
    dto: UpdateInactivitySettingsDto,
  ): Promise<InactivitySettings> {
    const data: any = { ...dto };
    if (dto.bandsDays) {
      const days = dto.bandsDays;
      const units: BandsUnit[] =
        dto.bandsUnits && dto.bandsUnits.length === days.length
          ? (dto.bandsUnits as BandsUnit[])
          : days.map(() => (dto.bandsUnit === 'HOURS' ? 'HOURS' : 'DAYS'));
      // Ordena as faixas por tempo ABSOLUTO (h e d convertidos), mantendo
      // valor e unidade juntos. Ex.: 12h vem antes de 1d.
      const pairs = days
        .map((value, i) => ({ value, unit: units[i] }))
        .sort((a, b) => bandHours(a.value, a.unit) - bandHours(b.value, b.unit));
      data.bandsDays = pairs.map((p) => p.value);
      data.bandsUnits = pairs.map((p) => p.unit);
    }
    return this.repo.upsert(organizationId, data);
  }
}
