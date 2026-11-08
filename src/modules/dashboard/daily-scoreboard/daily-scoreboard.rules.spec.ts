import {
  buildDailyScoreboard,
  localDayBounds,
  OpenConversationRow,
  parseScoreboardDate,
  ScoreboardInput,
} from './daily-scoreboard.rules';

const T = (iso: string) => new Date(iso);
const SP = 'America/Sao_Paulo';

function input(overrides: Partial<ScoreboardInput> = {}): ScoreboardInput {
  return {
    date: '2026-11-08',
    timezone: SP,
    generatedAt: T('2026-11-08T15:00:00Z'),
    openConversations: [],
    lastAssignments: [],
    dayAssignments: [],
    closedTodayByAgent: new Map(),
    enteredToday: 0,
    agents: [
      { id: 'marcella', name: 'Marcella', avatarUrl: null },
      { id: 'pedro', name: 'Pedro', avatarUrl: null },
    ],
    rosterIds: new Set(['marcella', 'pedro']),
    ...overrides,
  };
}

function open(overrides: Partial<OpenConversationRow>): OpenConversationRow {
  return {
    id: 'c',
    assignedToId: 'marcella',
    createdAt: T('2026-11-01T12:00:00Z'),
    reopenedAt: null,
    lastHumanReplyAt: null,
    awaitingHumanReply: false,
    lastInboundAt: null,
    ...overrides,
  };
}

const rowOf = (r: ReturnType<typeof buildDailyScoreboard>, id: string) => r.agents.find((a) => a.agent.id === id)!;

describe('parseScoreboardDate', () => {
  it('aceita data real e recusa formato ou dia inexistente', () => {
    expect(parseScoreboardDate('2026-11-08')).toBe('2026-11-08');
    expect(parseScoreboardDate('2026-02-30')).toBeNull();
    expect(parseScoreboardDate('08/11/2026')).toBeNull();
    expect(parseScoreboardDate('2026-11-8')).toBeNull();
  });
});

describe('localDayBounds', () => {
  it('dia de Brasília vai das 03:00 UTC às 03:00 UTC do dia seguinte', () => {
    const { start, end } = localDayBounds('2026-11-08', SP);
    expect(start.toISOString()).toBe('2026-11-08T03:00:00.000Z');
    expect(end.toISOString()).toBe('2026-11-09T03:00:00.000Z');
  });

  it('vira o mês corretamente', () => {
    expect(localDayBounds('2026-11-30', SP).end.toISOString()).toBe('2026-12-01T03:00:00.000Z');
  });
});

describe('buildDailyScoreboard', () => {
  it('não começou = sem resposta humana desde a última atribuição (inclui as antigas)', () => {
    const r = buildDailyScoreboard(
      input({
        openConversations: [
          // atribuída hoje, nunca respondida
          open({ id: 'a' }),
          // respondida antes, reatribuída depois → não começou com o dono atual
          open({ id: 'b', lastHumanReplyAt: T('2026-11-05T12:00:00Z') }),
          // respondida depois da atribuição → começou
          open({ id: 'c', lastHumanReplyAt: T('2026-11-08T14:00:00Z') }),
        ],
        lastAssignments: [
          { conversationId: 'a', agentId: 'marcella', assignedAt: T('2026-11-08T13:00:00Z') },
          { conversationId: 'b', agentId: 'marcella', assignedAt: T('2026-11-07T12:00:00Z') },
          { conversationId: 'c', agentId: 'marcella', assignedAt: T('2026-11-08T12:00:00Z') },
        ],
      }),
    );
    const m = rowOf(r, 'marcella');
    expect(m.notStarted).toBe(2);
    expect(m.notStartedOldestSince).toBe('2026-11-07T12:00:00.000Z');
    expect(m.openTotal).toBe(3);
  });

  it('sem log do dono atual, usa a entrada da conversa como atribuição', () => {
    const r = buildDailyScoreboard(
      input({
        openConversations: [
          open({ id: 'a', createdAt: T('2026-11-02T12:00:00Z'), lastHumanReplyAt: T('2026-11-03T12:00:00Z') }),
          open({ id: 'b', createdAt: T('2026-11-02T12:00:00Z'), reopenedAt: T('2026-11-06T12:00:00Z') }),
        ],
        // log antigo de OUTRO vendedor não vale para o dono atual
        lastAssignments: [{ conversationId: 'a', agentId: 'pedro', assignedAt: T('2026-11-04T12:00:00Z') }],
      }),
    );
    const m = rowOf(r, 'marcella');
    expect(m.notStarted).toBe(1);
    expect(m.notStartedOldestSince).toBe('2026-11-06T12:00:00.000Z');
  });

  it('esperando resposta não conta as que nem começaram', () => {
    const r = buildDailyScoreboard(
      input({
        openConversations: [
          open({ id: 'a', awaitingHumanReply: true, lastInboundAt: T('2026-11-08T10:00:00Z') }),
          open({
            id: 'b',
            awaitingHumanReply: true,
            lastHumanReplyAt: T('2026-11-08T11:00:00Z'),
            lastInboundAt: T('2026-11-08T12:30:00Z'),
          }),
          open({
            id: 'c',
            awaitingHumanReply: true,
            lastHumanReplyAt: T('2026-11-08T11:00:00Z'),
            lastInboundAt: T('2026-11-08T11:40:00Z'),
          }),
        ],
        lastAssignments: [
          { conversationId: 'b', agentId: 'marcella', assignedAt: T('2026-11-08T10:00:00Z') },
          { conversationId: 'c', agentId: 'marcella', assignedAt: T('2026-11-08T10:00:00Z') },
        ],
      }),
    );
    const m = rowOf(r, 'marcella');
    expect(m.notStarted).toBe(1);
    expect(m.awaitingReply).toBe(2);
    expect(m.awaitingOldestSince).toBe('2026-11-08T11:40:00.000Z');
  });

  it('recebidos e iniciados do dia, com tempo médio até a 1ª resposta', () => {
    const r = buildDailyScoreboard(
      input({
        dayAssignments: [
          // respondeu pelo painel 10 min depois
          {
            conversationId: 'a',
            agentId: 'pedro',
            assignedAt: T('2026-11-08T12:00:00Z'),
            firstReplyAt: T('2026-11-08T12:10:00Z'),
            lastHumanReplyAt: T('2026-11-08T16:00:00Z'),
          },
          // respondeu pelo celular 30 min depois (só lastHumanReplyAt)
          {
            conversationId: 'b',
            agentId: 'pedro',
            assignedAt: T('2026-11-08T12:00:00Z'),
            firstReplyAt: null,
            lastHumanReplyAt: T('2026-11-08T12:30:00Z'),
          },
          // resposta antiga, de antes da atribuição → não começou
          {
            conversationId: 'c',
            agentId: 'pedro',
            assignedAt: T('2026-11-08T12:00:00Z'),
            firstReplyAt: null,
            lastHumanReplyAt: T('2026-11-07T12:00:00Z'),
          },
        ],
      }),
    );
    const p = rowOf(r, 'pedro');
    expect(p.assignedToday).toBe(3);
    expect(p.startedToday).toBe(2);
    expect(p.avgPickupMinutes).toBe(20);
  });

  it('fila: sem dono, mais antiga pela reabertura, e quem entrou hoje', () => {
    const r = buildDailyScoreboard(
      input({
        enteredToday: 40,
        openConversations: [
          open({ id: 'a', assignedToId: null, createdAt: T('2026-11-07T22:10:00Z') }),
          open({ id: 'b', assignedToId: null, createdAt: T('2026-11-01T00:00:00Z'), reopenedAt: T('2026-11-08T01:00:00Z') }),
          open({ id: 'c' }),
        ],
      }),
    );
    expect(r.queue).toEqual({ unassigned: 2, oldestSince: '2026-11-07T22:10:00.000Z', enteredToday: 40 });
  });

  it('atendente ativo aparece zerado; ex-membro só aparece com número', () => {
    const r = buildDailyScoreboard(
      input({
        agents: [
          { id: 'marcella', name: 'Marcella', avatarUrl: null },
          { id: 'ex', name: 'Ex', avatarUrl: null },
          { id: 'ex2', name: 'Ex2', avatarUrl: null },
        ],
        rosterIds: new Set(['marcella']),
        closedTodayByAgent: new Map([['ex', 3]]),
      }),
    );
    expect(r.agents.map((a) => a.agent.id).sort()).toEqual(['ex', 'marcella']);
    expect(rowOf(r, 'marcella')).toMatchObject({
      assignedToday: 0,
      closedToday: 0,
      avgPickupMinutes: null,
      notStartedOldestSince: null,
    });
    expect(rowOf(r, 'ex').closedToday).toBe(3);
  });

  it('ordena por recebidos hoje, depois carteira, depois nome', () => {
    const r = buildDailyScoreboard(
      input({
        openConversations: [open({ id: 'a', assignedToId: 'marcella' })],
        dayAssignments: [
          { conversationId: 'x', agentId: 'pedro', assignedAt: T('2026-11-08T12:00:00Z'), firstReplyAt: null, lastHumanReplyAt: null },
        ],
      }),
    );
    expect(r.agents.map((a) => a.agent.id)).toEqual(['pedro', 'marcella']);
  });
});
