/**
 * Placar do dia (consumido pelo OFP Hub): regras puras, sem banco.
 * Contrato e definição de cada número: OFP HUB/docs/sendtur-placar-diario.md.
 */

const MINUTE_MS = 60_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DayBounds {
  start: Date;
  end: Date; // exclusivo
}

export interface ScoreboardAgentInfo {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface OpenConversationRow {
  id: string;
  assignedToId: string | null;
  createdAt: Date;
  reopenedAt: Date | null;
  lastHumanReplyAt: Date | null;
  awaitingHumanReply: boolean;
  lastInboundAt: Date | null;
}

/** Última atribuição (log ASSIGNED mais recente) de uma conversa aberta. */
export interface LastAssignmentRow {
  conversationId: string;
  agentId: string;
  assignedAt: Date;
}

/** Atribuição feita no dia: uma linha por (conversa, vendedor), a mais cedo. */
export interface DayAssignmentRow {
  conversationId: string;
  agentId: string;
  assignedAt: Date;
  lastHumanReplyAt: Date | null;
  /** 1ª mensagem humana do próprio vendedor depois da atribuição. */
  firstReplyAt: Date | null;
}

export interface ScoreboardInput {
  date: string;
  timezone: string;
  generatedAt: Date;
  openConversations: OpenConversationRow[];
  lastAssignments: LastAssignmentRow[];
  dayAssignments: DayAssignmentRow[];
  closedTodayByAgent: Map<string, number>;
  enteredToday: number;
  /** Nomes de quem aparece nos números + atendentes ativos (aparecem zerados). */
  agents: ScoreboardAgentInfo[];
  /** Atendentes ativos: aparecem mesmo com tudo zerado. */
  rosterIds: Set<string>;
}

export interface ScoreboardAgentRow {
  agent: ScoreboardAgentInfo;
  assignedToday: number;
  startedToday: number;
  notStarted: number;
  notStartedOldestSince: string | null;
  awaitingReply: number;
  awaitingOldestSince: string | null;
  closedToday: number;
  openTotal: number;
  avgPickupMinutes: number | null;
}

export interface DailyScoreboard {
  date: string;
  timezone: string;
  generatedAt: string;
  queue: { unassigned: number; oldestSince: string | null; enteredToday: number };
  agents: ScoreboardAgentRow[];
}

/** "YYYY-MM-DD" válido no calendário, ou null. */
export function parseScoreboardDate(value: string): string | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  const isRealDay =
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
  return isRealDay ? value : null;
}

export function localDateKey(at: Date, timeZone: string): string {
  // en-CA formata como "YYYY-MM-DD".
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Diferença (em minutos) entre o relógio local e o UTC naquele instante. */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - (at.getTime() - (at.getTime() % MINUTE_MS))) / MINUTE_MS);
}

function localMidnight(y: number, m: number, d: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetMinutes(new Date(guess), timeZone) * MINUTE_MS;
  // Segunda passada corrige o caso de o offset mudar entre o palpite e a meia-noite.
  return new Date(guess - offsetMinutes(new Date(first), timeZone) * MINUTE_MS);
}

/** Meia-noite a meia-noite do dia `date` no fuso `timeZone`, em UTC. */
export function localDayBounds(date: string, timeZone: string): DayBounds {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return {
    start: localMidnight(y, m, d, timeZone),
    end: localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone),
  };
}

const iso = (at: Date | null): string | null => (at ? at.toISOString() : null);

function earliest(current: Date | null, candidate: Date | null): Date | null {
  if (!candidate) return current;
  return !current || candidate < current ? candidate : current;
}

interface AgentTally {
  assignedToday: number;
  startedToday: number;
  pickupMinutes: number[];
  notStarted: number;
  notStartedOldest: Date | null;
  awaitingReply: number;
  awaitingOldest: Date | null;
  openTotal: number;
}

const emptyTally = (): AgentTally => ({
  assignedToday: 0,
  startedToday: 0,
  pickupMinutes: [],
  notStarted: 0,
  notStartedOldest: null,
  awaitingReply: 0,
  awaitingOldest: null,
  openTotal: 0,
});

/**
 * Quando a conversa passou para o dono atual. Sem log ASSIGNED desse dono
 * (atribuições antigas, antes do log existir em todos os caminhos), cai na
 * entrada da conversa.
 */
function currentAssignmentAt(conv: OpenConversationRow, last: LastAssignmentRow | undefined): Date {
  if (last && last.agentId === conv.assignedToId) return last.assignedAt;
  return conv.reopenedAt && conv.reopenedAt > conv.createdAt ? conv.reopenedAt : conv.createdAt;
}

function tallyOpenConversation(
  tally: AgentTally,
  conv: OpenConversationRow,
  last: LastAssignmentRow | undefined,
): void {
  tally.openTotal += 1;
  const assignedAt = currentAssignmentAt(conv, last);
  const isNotStarted = !conv.lastHumanReplyAt || conv.lastHumanReplyAt < assignedAt;
  if (isNotStarted) {
    tally.notStarted += 1;
    tally.notStartedOldest = earliest(tally.notStartedOldest, assignedAt);
    return;
  }
  if (conv.awaitingHumanReply) {
    tally.awaitingReply += 1;
    tally.awaitingOldest = earliest(tally.awaitingOldest, conv.lastInboundAt);
  }
}

function tallyDayAssignment(tally: AgentTally, row: DayAssignmentRow): void {
  tally.assignedToday += 1;
  // Resposta pelo painel tem mensagem do vendedor; pelo app do celular
  // (coexistência) só sobra o lastHumanReplyAt da conversa.
  const repliedAt =
    row.firstReplyAt ??
    (row.lastHumanReplyAt && row.lastHumanReplyAt >= row.assignedAt ? row.lastHumanReplyAt : null);
  if (!repliedAt) return;
  tally.startedToday += 1;
  tally.pickupMinutes.push((repliedAt.getTime() - row.assignedAt.getTime()) / MINUTE_MS);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

function hasAnyNumber(t: AgentTally, closedToday: number): boolean {
  return t.assignedToday + t.notStarted + t.awaitingReply + t.openTotal + closedToday > 0;
}

function buildQueue(input: ScoreboardInput): DailyScoreboard['queue'] {
  const unassigned = input.openConversations.filter((c) => !c.assignedToId);
  const oldest = unassigned.reduce<Date | null>(
    (acc, c) => earliest(acc, c.reopenedAt && c.reopenedAt > c.createdAt ? c.reopenedAt : c.createdAt),
    null,
  );
  return { unassigned: unassigned.length, oldestSince: iso(oldest), enteredToday: input.enteredToday };
}

export function buildDailyScoreboard(input: ScoreboardInput): DailyScoreboard {
  const tallies = new Map<string, AgentTally>();
  const tallyOf = (agentId: string): AgentTally => {
    const existing = tallies.get(agentId);
    if (existing) return existing;
    const created = emptyTally();
    tallies.set(agentId, created);
    return created;
  };

  const lastByConversation = new Map(input.lastAssignments.map((l) => [l.conversationId, l]));
  for (const conv of input.openConversations) {
    if (!conv.assignedToId) continue;
    tallyOpenConversation(tallyOf(conv.assignedToId), conv, lastByConversation.get(conv.id));
  }
  for (const row of input.dayAssignments) tallyDayAssignment(tallyOf(row.agentId), row);

  const agentById = new Map(input.agents.map((a) => [a.id, a]));
  const ids = new Set([...tallies.keys(), ...input.closedTodayByAgent.keys(), ...input.rosterIds]);

  const agents = [...ids]
    .map((id): ScoreboardAgentRow | null => {
      const agent = agentById.get(id);
      if (!agent) return null;
      const t = tallies.get(id) ?? emptyTally();
      const closedToday = input.closedTodayByAgent.get(id) ?? 0;
      if (!input.rosterIds.has(id) && !hasAnyNumber(t, closedToday)) return null;
      return {
        agent,
        assignedToday: t.assignedToday,
        startedToday: t.startedToday,
        notStarted: t.notStarted,
        notStartedOldestSince: iso(t.notStartedOldest),
        awaitingReply: t.awaitingReply,
        awaitingOldestSince: iso(t.awaitingOldest),
        closedToday,
        openTotal: t.openTotal,
        avgPickupMinutes: average(t.pickupMinutes),
      };
    })
    .filter((row): row is ScoreboardAgentRow => row !== null)
    .sort(
      (a, b) =>
        b.assignedToday - a.assignedToday ||
        b.openTotal - a.openTotal ||
        a.agent.name.localeCompare(b.agent.name, 'pt-BR'),
    );

  return {
    date: input.date,
    timezone: input.timezone,
    generatedAt: input.generatedAt.toISOString(),
    queue: buildQueue(input),
    agents,
  };
}
