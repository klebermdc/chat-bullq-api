import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { FetchLike, OPERATORS, OperatorDef, fetchOperatorRate } from './exchange-rates.sources';

/** Duas buscas perdidas (5h cada) → o valor aparece como desatualizado. */
export const STALE_AFTER_MS = 11 * 60 * 60 * 1000;
const MAX_ERROR_LENGTH = 300;

export interface OperatorRateView {
  code: string;
  name: string;
  url: string;
  /** R$ por US$ 1; null quando não há leitura (ou AZ, que é só link). */
  value: number | null;
  sourceUpdatedLabel: string | null;
  fetchedAt: string | null;
  changedAt: string | null;
  stale: boolean;
  /** true = sem busca automática, o atendente consulta no site. */
  manual: boolean;
}

export interface RefreshResult {
  updated: string[];
  changed: string[];
  failed: { code: string; error: string }[];
}

/** Opt-in por org: `organizations.settings.operatorExchangeRates = true`. */
export function isEnabledFor(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
  return (settings as Record<string, unknown>).operatorExchangeRates === true;
}

@Injectable()
export class ExchangeRatesService {
  private readonly logger = new Logger(ExchangeRatesService.name);
  private fetchImpl: FetchLike = fetch;

  constructor(private readonly prisma: PrismaService) {}

  /** Para testes. */
  useFetch(fetchImpl: FetchLike): this {
    this.fetchImpl = fetchImpl;
    return this;
  }

  async refreshAll(now: Date = new Date()): Promise<RefreshResult> {
    const result: RefreshResult = { updated: [], changed: [], failed: [] };
    for (const op of OPERATORS.filter((o) => o.source !== 'link')) {
      try {
        const changed = await this.refreshOne(op, now);
        result.updated.push(op.code);
        if (changed) result.changed.push(op.code);
      } catch (err) {
        const error = (err instanceof Error ? err.message : String(err)).slice(0, MAX_ERROR_LENGTH);
        result.failed.push({ code: op.code, error });
        await this.recordError(op.code, error, now);
      }
    }
    this.logger.log(
      `exchange_rates updated=${result.updated.join(',') || '-'} changed=${result.changed.join(',') || '-'} failed=${result.failed.length}`,
    );
    return result;
  }

  private async refreshOne(op: OperatorDef, now: Date): Promise<boolean> {
    const fetched = await fetchOperatorRate(op, this.fetchImpl);
    const value = new Prisma.Decimal(fetched.value.toFixed(4));
    const current = await this.prisma.operatorExchangeRate.findUnique({ where: { code: op.code } });
    const changed = !current || !new Prisma.Decimal(current.value).equals(value);
    const changedAt = changed ? now : current.changedAt;
    await this.prisma.operatorExchangeRate.upsert({
      where: { code: op.code },
      create: { code: op.code, value, sourceUpdatedLabel: fetched.sourceUpdatedLabel, fetchedAt: now, changedAt: now },
      update: {
        value,
        sourceUpdatedLabel: fetched.sourceUpdatedLabel,
        fetchedAt: now,
        changedAt,
        lastError: null,
        lastErrorAt: null,
      },
    });
    return changed;
  }

  private async recordError(code: string, error: string, now: Date): Promise<void> {
    this.logger.warn(`exchange_rates ${code} falhou: ${error}`);
    const exists = await this.prisma.operatorExchangeRate.findUnique({ where: { code } });
    // Sem leitura anterior não há linha para marcar; o próximo ciclo tenta de novo.
    if (!exists) return;
    await this.prisma.operatorExchangeRate.update({
      where: { code },
      data: { lastError: error, lastErrorAt: now },
    });
  }

  async listFor(organizationId: string, now: Date = new Date()): Promise<{ enabled: boolean; rates: OperatorRateView[] }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    if (!isEnabledFor(org?.settings)) return { enabled: false, rates: [] };

    const rows = await this.prisma.operatorExchangeRate.findMany();
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const rates = OPERATORS.map((op): OperatorRateView => {
      const row = op.source === 'link' ? undefined : byCode.get(op.code);
      return {
        code: op.code,
        name: op.name,
        url: op.url,
        value: row ? Number(row.value) : null,
        sourceUpdatedLabel: row?.sourceUpdatedLabel ?? null,
        fetchedAt: row?.fetchedAt?.toISOString() ?? null,
        changedAt: row?.changedAt?.toISOString() ?? null,
        stale: row ? now.getTime() - row.fetchedAt.getTime() > STALE_AFTER_MS : false,
        manual: op.source === 'link',
      };
    });
    return { enabled: true, rates };
  }
}
