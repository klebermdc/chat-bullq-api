/**
 * Formatação pura das variáveis dos templates. A Meta recusa variável com
 * quebra de linha, tab ou 4+ espaços seguidos — tudo passa pelo
 * `sanitizeTemplateParam` antes de sair.
 */

export const NONE_PLACEHOLDER = 'nenhum';
export const UNASSIGNED_LABEL = 'sem dono';
export const MAX_PARAM_LENGTH = 300;
const EMPTY_PARAM = '-';

export function sanitizeTemplateParam(value: string): string {
  const flat = value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!flat) return EMPTY_PARAM;
  return flat.length > MAX_PARAM_LENGTH ? `${flat.slice(0, MAX_PARAM_LENGTH - 1)}…` : flat;
}

export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] || EMPTY_PARAM;
}

function ownerLabel(agentName: string | null): string {
  return agentName ? firstName(agentName) : UNASSIGNED_LABEL;
}

/** "Pedro 2, Suelen 1, sem dono 1" — quantidade desc; no empate, "sem dono" por último. */
export function formatAgentBreakdown(waits: ReadonlyArray<{ agentName: string | null }>): string {
  if (waits.length === 0) return NONE_PLACEHOLDER;
  const counts = waits.reduce(
    (acc, w) => {
      const label = ownerLabel(w.agentName);
      return { ...acc, [label]: (acc[label] ?? 0) + 1 };
    },
    {} as Record<string, number>,
  );
  return Object.entries(counts)
    .sort(
      ([a, ca], [b, cb]) =>
        cb - ca ||
        Number(a === UNASSIGNED_LABEL) - Number(b === UNASSIGNED_LABEL) ||
        a.localeCompare(b, 'pt-BR'),
    )
    .map(([label, count]) => `${label} ${count}`)
    .join(', ');
}

/** "Maria Silva com Pedro, 52 min" — a espera com mais minutos úteis. */
export function formatOldest(
  waits: ReadonlyArray<{ contactName: string; agentName: string | null; businessMinutes: number }>,
): string {
  if (waits.length === 0) return NONE_PLACEHOLDER;
  const oldest = waits.reduce((max, w) => (w.businessMinutes > max.businessMinutes ? w : max));
  const owner = oldest.agentName ? `com ${firstName(oldest.agentName)}` : UNASSIGNED_LABEL;
  return `${oldest.contactName} ${owner}, ${Math.floor(oldest.businessMinutes)} min`;
}

export interface WithinCount {
  within: number;
  total: number;
}

/** "82% (41 de 50 no prazo)". */
export function formatOverall(count: WithinCount | null): string {
  if (!count || count.total === 0) return NONE_PLACEHOLDER;
  const percent = Math.round((count.within / count.total) * 100);
  return `${percent}% (${count.within} de ${count.total} no prazo)`;
}

/** "Renata 94%, Pedro 71%" — percentual desc, depois nome. */
export function formatAgentScores(
  agents: ReadonlyArray<{ agentName: string; percent: number }>,
): string {
  if (agents.length === 0) return NONE_PLACEHOLDER;
  return [...agents]
    .sort((a, b) => b.percent - a.percent || a.agentName.localeCompare(b.agentName, 'pt-BR'))
    .map((a) => `${firstName(a.agentName)} ${a.percent}%`)
    .join(', ');
}
