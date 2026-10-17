import { FailureCount, summarizeFailures } from './failure-reason.util';
import { roundTo } from './round.util';
import { toZonedDayKey } from './zoned-day.util';

const READ_STATUS = 'READ';
const DELIVERED_STATUS = 'DELIVERED';
const FAILED_STATUS = 'FAILED';

/** Contagem pré-agregada por hora cheia, status e "é template". */
export interface DeliveryBucketRow {
  bucketAt: Date;
  /** MessageStatus: QUEUED | SENT | DELIVERED | READ | FAILED */
  status: string;
  isTemplate: boolean;
  count: number;
}

export interface DeliveryDay {
  date: string;
  outbound: number;
  delivered: number;
  read: number;
  failed: number;
  templates: number;
  freeForm: number;
}

export interface DeliveryResponse {
  totals: {
    outbound: number;
    delivered: number;
    read: number;
    failed: number;
    pending: number;
    deliveryRate: number;
    readRate: number;
    failureRate: number;
  };
  daily: DeliveryDay[];
  failuresByReason: Array<{ reason: string; count: number }>;
}

export interface DeliveryAggregateInput {
  rows: DeliveryBucketRow[];
  dayKeys: string[];
  /** Falhas agrupadas pelo texto cru de `failed_reason`. */
  failures: FailureCount[];
}

function emptyDay(date: string): DeliveryDay {
  return {
    date,
    outbound: 0,
    delivered: 0,
    read: 0,
    failed: 0,
    templates: 0,
    freeForm: 0,
  };
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? roundTo(part / whole) : 0;
}

function addRow(day: DeliveryDay, row: DeliveryBucketRow): DeliveryDay {
  const isRead = row.status === READ_STATUS;
  const isDelivered = isRead || row.status === DELIVERED_STATUS;
  return {
    ...day,
    outbound: day.outbound + row.count,
    delivered: day.delivered + (isDelivered ? row.count : 0),
    read: day.read + (isRead ? row.count : 0),
    failed: day.failed + (row.status === FAILED_STATUS ? row.count : 0),
    templates: day.templates + (row.isTemplate ? row.count : 0),
    freeForm: day.freeForm + (row.isTemplate ? 0 : row.count),
  };
}

export function aggregateDelivery(input: DeliveryAggregateInput): DeliveryResponse {
  const days = new Map<string, DeliveryDay>();
  for (const date of input.dayKeys) days.set(date, emptyDay(date));

  for (const row of input.rows) {
    const date = toZonedDayKey(row.bucketAt);
    days.set(date, addRow(days.get(date) ?? emptyDay(date), row));
  }

  const daily = [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
  const sum = (pick: (day: DeliveryDay) => number) =>
    daily.reduce((total, day) => total + pick(day), 0);

  const outbound = sum((d) => d.outbound);
  const delivered = sum((d) => d.delivered);
  const read = sum((d) => d.read);
  const failed = sum((d) => d.failed);

  return {
    totals: {
      outbound,
      delivered,
      read,
      failed,
      pending: outbound - delivered - failed,
      deliveryRate: ratio(delivered, outbound),
      readRate: ratio(read, delivered),
      failureRate: ratio(failed, outbound),
    },
    daily,
    failuresByReason: summarizeFailures(input.failures),
  };
}
