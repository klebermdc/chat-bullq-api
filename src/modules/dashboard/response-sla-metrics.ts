import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../database/prisma.service';
import { parseResponseSlaMinutes } from '../response-sla/response-sla.rules';

/**
 * Métricas do SLA de resposta em horário útil (tabela response_sla_records).
 *
 * Uma espera CONTA no % quando foi respondida por humano ou estourou a meta.
 * Fica de fora a espera que acabou sem resposta e sem estourar (finalizada,
 * arquivada, retirada do Esperando) e a que ainda está correndo no prazo.
 */

interface DateRange {
  from: Date;
  to: Date;
}

interface CountedRow {
  agentId: string | null;
  waitingSince: Date;
  respondedAt: Date | null;
  businessMinutes: number | null;
  breached: boolean;
}

/** Esperas que entram no %: respondidas por humano ou estouradas. */
export const COUNTED_WAIT_WHERE = {
  OR: [{ respondedAt: { not: null } }, { breached: true }],
} satisfies Prisma.ResponseSlaRecordWhereInput;

export interface AgentResponseSla {
  avgBusinessResponseMinutes: number | null;
  responseSlaPercent: number | null;
}

export async function isResponseSlaEnabled(
  prisma: PrismaService,
  organizationId: string,
): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { settings: true },
  });
  return parseResponseSlaMinutes(org?.settings) !== null;
}

export async function responseSlaCompliance(
  prisma: PrismaService,
  organizationId: string,
  range: DateRange,
  agentId?: string,
): Promise<number | null> {
  return percentWithin(await countedRows(prisma, organizationId, range, agentId));
}

export async function responseSlaDailySeries(
  prisma: PrismaService,
  organizationId: string,
  range: DateRange,
  dayKeys: string[],
  agentId?: string,
): Promise<Array<{ date: string; value: number }>> {
  const rows = await countedRows(prisma, organizationId, range, agentId);
  const byDay = groupBy(rows, (r) => r.waitingSince.toISOString().slice(0, 10));
  return dayKeys.map((date) => ({ date, value: percentWithin(byDay.get(date) ?? []) ?? 0 }));
}

export async function responseSlaByAgent(
  prisma: PrismaService,
  organizationId: string,
  range: DateRange,
  agentId?: string,
): Promise<Map<string, AgentResponseSla>> {
  const rows = await countedRows(prisma, organizationId, range, agentId);
  const byAgent = groupBy(
    rows.filter((r) => r.agentId !== null),
    (r) => r.agentId as string,
  );
  return new Map(
    [...byAgent].map(([id, agentRows]) => [
      id,
      {
        avgBusinessResponseMinutes: average(
          agentRows.flatMap((r) => (r.businessMinutes === null ? [] : [r.businessMinutes])),
        ),
        responseSlaPercent: percentWithin(agentRows),
      },
    ]),
  );
}

function countedRows(
  prisma: PrismaService,
  organizationId: string,
  range: DateRange,
  agentId?: string,
): Promise<CountedRow[]> {
  const where: Prisma.ResponseSlaRecordWhereInput = {
    organizationId,
    ...(agentId ? { agentId } : {}),
    waitingSince: { gte: range.from, lte: range.to },
    ...COUNTED_WAIT_WHERE,
  };
  return prisma.responseSlaRecord.findMany({
    where,
    select: {
      agentId: true,
      waitingSince: true,
      respondedAt: true,
      businessMinutes: true,
      breached: true,
    },
  });
}

/**
 * Quantas esperas contadas ficaram no prazo (respondida e sem estouro).
 * Exportada para o placar diário da gestão usar a MESMA regra do dashboard.
 */
export function countWithin(
  rows: ReadonlyArray<Pick<CountedRow, 'respondedAt' | 'breached'>>,
): { within: number; total: number } {
  const within = rows.filter((r) => r.respondedAt !== null && !r.breached).length;
  return { within, total: rows.length };
}

function percentWithin(rows: CountedRow[]): number | null {
  if (rows.length === 0) return null;
  const { within, total } = countWithin(rows);
  return Math.round((within / total) * 100);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

/** Agrupa num Map novo (as listas de entrada não são alteradas). */
function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    groups.set(k, (groups.get(k) ?? []).concat(item));
  }
  return groups;
}
