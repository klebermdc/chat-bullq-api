/** Quem gera o custo: agrega as mensagens cobradas lidas dos webhooks (puro). */

export type SenderKind = 'agent' | 'ai' | 'system';

export interface BilledMessageRow {
  /** Categoria da Meta em maiúsculas (SERVICE, MARKETING...). */
  category: string;
  conversationId: string | null;
  senderId: string | null;
  senderName: string | null;
  userName: string | null;
  isAi: boolean;
  isAutomated: boolean;
  templateName: string | null;
  templateCategory: string | null;
}

export interface SenderRow {
  name: string;
  kind: SenderKind;
  service: number;
  marketing: number;
  utility: number;
  cost: number;
  conversations: number;
}

export interface TemplateRow {
  name: string;
  category: string | null;
  sent: number;
  cost: number;
}

export interface PerConversation {
  median: number;
  p90: number;
  max: number;
  conversations: number;
}

export const AUTOMATION_NAME = 'Automações (cadência e avisos)';
const SYSTEM_NAME = 'Sistema';
const NO_NAME = 'Sem nome';
const round = (value: number): number => Number(value.toFixed(2));

export function senderOf(row: BilledMessageRow): { key: string; name: string; kind: SenderKind } {
  if (row.isAi) return { key: `ai:${row.senderName ?? ''}`, name: row.senderName || 'IA', kind: 'ai' };
  if (row.isAutomated) return { key: 'automation', name: AUTOMATION_NAME, kind: 'system' };
  if (row.senderId) return { key: `u:${row.senderId}`, name: row.userName || row.senderName || NO_NAME, kind: 'agent' };
  return { key: 'system', name: SYSTEM_NAME, kind: 'system' };
}

const priceOf = (prices: Record<string, number>, category: string): number => prices[category] ?? 0;

export function bySender(rows: ReadonlyArray<BilledMessageRow>, prices: Record<string, number>): SenderRow[] {
  const acc = new Map<string, SenderRow & { convs: Set<string> }>();
  for (const row of rows) {
    const who = senderOf(row);
    const prev = acc.get(who.key) ?? {
      name: who.name, kind: who.kind, service: 0, marketing: 0, utility: 0, cost: 0, conversations: 0, convs: new Set<string>(),
    };
    const convs = row.conversationId ? new Set([...prev.convs, row.conversationId]) : prev.convs;
    acc.set(who.key, {
      ...prev,
      service: prev.service + (row.category === 'SERVICE' ? 1 : 0),
      marketing: prev.marketing + (row.category === 'MARKETING' ? 1 : 0),
      utility: prev.utility + (row.category === 'UTILITY' ? 1 : 0),
      cost: prev.cost + priceOf(prices, row.category),
      convs,
    });
  }
  return [...acc.values()]
    .map(({ convs, ...rest }) => ({ ...rest, cost: round(rest.cost), conversations: convs.size }))
    .sort((a, b) => b.cost - a.cost);
}

export function byTemplate(rows: ReadonlyArray<BilledMessageRow>, prices: Record<string, number>): TemplateRow[] {
  const acc = new Map<string, TemplateRow>();
  for (const row of rows) {
    if (!row.templateName) continue;
    const prev = acc.get(row.templateName) ?? { name: row.templateName, category: row.templateCategory, sent: 0, cost: 0 };
    acc.set(row.templateName, { ...prev, sent: prev.sent + 1, cost: prev.cost + priceOf(prices, row.category) });
  }
  return [...acc.values()].map((t) => ({ ...t, cost: round(t.cost) })).sort((a, b) => b.cost - a.cost);
}

/** Percentil por posição mais próxima (lista já ordenada). */
export function percentile(sorted: ReadonlyArray<number>, p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

/** Respostas cobradas (SERVICE) por conversa. */
export function perConversation(rows: ReadonlyArray<BilledMessageRow>): PerConversation | null {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.category !== 'SERVICE' || !row.conversationId) continue;
    counts.set(row.conversationId, (counts.get(row.conversationId) ?? 0) + 1);
  }
  const sorted = [...counts.values()].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return { median: percentile(sorted, 50), p90: percentile(sorted, 90), max: sorted[sorted.length - 1], conversations: sorted.length };
}
