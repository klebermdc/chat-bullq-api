/** Campos mínimos para escolher a IA principal da org. */
export interface AgentCandidate {
  id: string;
  name: string;
  kind: string;
  systemPrompt: string;
  operationalContext: string | null;
  createdAt: Date;
  _count: { channels: number };
}

/** Select do Prisma que preenche um AgentCandidate (canais no automático). */
export const MAIN_AGENT_SELECT = {
  id: true,
  name: true,
  kind: true,
  systemPrompt: true,
  operationalContext: true,
  createdAt: true,
  _count: { select: { channels: { where: { mode: 'AUTONOMOUS' as const } } } },
};

/**
 * A IA de atendimento principal da org (a SDR que fala com o cliente): ligada a canal
 * no automático > orquestrador > mais canais > mais antiga. Sem nome fixo de agente.
 */
export function pickMainAgent<T extends AgentCandidate>(agents: T[]): T | null {
  const rank = (a: AgentCandidate) => [a._count.channels > 0 ? 0 : 1, a.kind === 'ORCHESTRATOR' ? 0 : 1, -a._count.channels, a.createdAt.getTime()];
  const sorted = [...agents].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    const i = ra.findIndex((v, idx) => v !== rb[idx]);
    return i === -1 ? 0 : ra[i] - rb[i];
  });
  return sorted[0] ?? null;
}
