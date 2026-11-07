import { LOST_REASON_CODES } from '../../pipelines/lost-sale.constants';
import type { InboxAdvancedFilters } from './inbox-advanced-where';

/** Teto de itens por lista na URL — protege a consulta de um IN gigante. */
const MAX_LIST_ITEMS = 100;
/** "Parado há mais de" vai até 1 ano. */
const MAX_IDLE_HOURS = 24 * 365;
const HOUR_MS = 60 * 60 * 1000;

/** Valores de ?assignedToId= que significam "sem atendente". */
export const UNASSIGNED_TOKENS = new Set(['none', 'null', 'unassigned']);

export interface AdvancedQuery {
  channelIds?: string;
  tagMode?: string;
  excludeTagIds?: string;
  stageIds?: string;
  lost?: string;
  lostReasons?: string;
  origin?: string;
  idleHours?: string;
  dateField?: string;
}

export type ParsedAdvancedQuery = Omit<
  InboxAdvancedFilters,
  'tagIds' | 'assignedToIds' | 'assignedToNone'
> & {
  channelIds?: string[];
  dateField?: 'lastMessage' | 'created';
};

export function parseList(raw?: string): string[] | undefined {
  const items = raw
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS);
  return items?.length ? items : undefined;
}

function pick<T extends string>(raw: string | undefined, allowed: readonly T[]): T | undefined {
  return allowed.find((v) => v === raw);
}

function parseIdleBefore(raw: string | undefined, now: Date): Date | undefined {
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const hours = Number(raw);
  if (hours < 1 || hours > MAX_IDLE_HOURS) return undefined;
  return new Date(now.getTime() - hours * HOUR_MS);
}

/**
 * ?assignedToId= aceita um id, "none", ou uma lista com os dois misturados.
 * Um id só continua no formato antigo para não mudar o plano da consulta.
 */
export function parseAssignees(raw: string | undefined): {
  assignedToId?: string;
  assignedToIds?: string[];
  assignedToNone?: boolean;
} {
  const tokens = parseList(raw) ?? [];
  const includeNone = tokens.some((t) => UNASSIGNED_TOKENS.has(t));
  const ids = tokens.filter((t) => !UNASSIGNED_TOKENS.has(t));
  const none = includeNone ? { assignedToNone: true } : {};
  if (ids.length === 0) return none;
  if (ids.length === 1 && !includeNone) return { assignedToId: ids[0] };
  return { assignedToIds: ids, ...none };
}

/** Lê os filtros avançados da URL. Valor desconhecido é ignorado, não erro. */
export function parseAdvancedQuery(q: AdvancedQuery, now: Date): ParsedAdvancedQuery {
  const lostReasons = parseList(q.lostReasons)?.filter((code) =>
    (LOST_REASON_CODES as string[]).includes(code),
  );
  const parsed: ParsedAdvancedQuery = {
    channelIds: parseList(q.channelIds),
    tagMatch: pick(q.tagMode, ['all'] as const),
    excludeTagIds: parseList(q.excludeTagIds),
    stageIds: parseList(q.stageIds),
    lost: pick(q.lost, ['only', 'exclude'] as const),
    lostReasons: lostReasons?.length ? lostReasons : undefined,
    origin: pick(q.origin, ['ad', 'organic'] as const),
    idleBefore: parseIdleBefore(q.idleHours, now),
    dateField: pick(q.dateField, ['created'] as const),
  };
  return Object.fromEntries(
    Object.entries(parsed).filter(([, v]) => v !== undefined),
  ) as ParsedAdvancedQuery;
}
