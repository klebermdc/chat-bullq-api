/**
 * Normaliza o `messages.failed_reason` (texto livre: erro da Meta no formato
 * `[code] title: message`, ou o motivo que o próprio app grava) em motivos
 * curtos em pt-BR para o relatório de entrega.
 */
export const MAX_FAILURE_REASONS = 8;
const FALLBACK_REASON_LENGTH = 60;
const EMPTY_REASON = 'Sem motivo informado';

const KNOWN_REASONS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  // 131047 = re-engagement; "Janela de atendimento…" é o bloqueio do MetaWindowGate.
  {
    pattern: /131047|re-?engagement|janela de atendimento/i,
    label: 'Janela de 24h fechada',
  },
  { pattern: /131026|undeliverable/i, label: 'Número não recebe mensagens' },
  { pattern: /131049|healthy ecosystem/i, label: 'Limite de marketing da Meta' },
];

export interface FailureCount {
  reason: string | null;
  count: number;
}

export function normalizeFailureReason(raw: string | null | undefined): string {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return EMPTY_REASON;
  const known = KNOWN_REASONS.find(({ pattern }) => pattern.test(text));
  if (known) return known.label;
  return text.slice(0, FALLBACK_REASON_LENGTH).trim();
}

/** Soma por motivo normalizado e devolve os maiores (count desc, depois nome). */
export function summarizeFailures(
  rows: FailureCount[],
  limit: number = MAX_FAILURE_REASONS,
): Array<{ reason: string; count: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const reason = normalizeFailureReason(row.reason);
    totals.set(reason, (totals.get(reason) ?? 0) + row.count);
  }
  return [...totals.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, limit);
}
