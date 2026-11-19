import {
  formatAttention,
  formatBreaches,
  formatDayClock,
  formatDayLabel,
  formatLeads,
  formatOldestWait,
  formatOnline,
  formatPulseTitle,
  formatTeamCounts,
  formatWaiting,
} from './team-pulse.format';

const sp = (isoLocal: string) => new Date(`${isoLocal}-03:00`);
const iso = (isoLocal: string) => sp(isoLocal).toISOString();
const TZ = 'America/Sao_Paulo';
const NOW = sp('2026-11-19T15:00:00');

const member = (name: string, status: 'online' | 'away' | 'offline', over: Record<string, unknown> = {}) => ({
  name,
  status,
  lastActiveAt: null as string | null,
  today: { firstSeenAt: null as string | null },
  ...over,
});

describe('títulos', () => {
  it('pulso na hora cheia: "15h · qui 19/11"', () => {
    expect(formatPulseTitle(NOW, TZ)).toBe('15h · qui 19/11');
  });

  it('pulso fora da hora cheia (teste manual) mostra o relógio', () => {
    expect(formatPulseTitle(sp('2026-11-19T15:37:00'), TZ)).toBe('15:37 · qui 19/11');
  });

  it('fechamento: "sáb 21/11"', () => {
    expect(formatDayLabel(sp('2026-11-21T22:00:00'), TZ)).toBe('sáb 21/11');
  });
});

describe('formatTeamCounts', () => {
  it('conta online, ausente e offline e omite o que é zero', () => {
    const rows = [member('Pedro', 'online'), member('Ana', 'online'), member('Gabriela', 'away')];
    expect(formatTeamCounts(rows)).toBe('2 online · 1 ausente');
  });

  it('diz "ninguém no horário" sem atendentes', () => {
    expect(formatTeamCounts([])).toBe('ninguém no horário');
  });
});

describe('formatOnline', () => {
  it('lista os online com a entrada de hoje, pelo primeiro nome', () => {
    const rows = [
      member('Pedro Souza', 'online', { today: { firstSeenAt: iso('2026-11-19T09:02:00') } }),
      member('Marcella Lima', 'online', { today: { firstSeenAt: null } }),
      member('Gabriela', 'away'),
    ];
    expect(formatOnline(rows, TZ)).toBe('Pedro (desde 09:02) · Marcella');
  });

  it('diz "ninguém" quando não há online', () => {
    expect(formatOnline([member('Gabriela', 'away')], TZ)).toBe('ninguém');
  });
});

describe('formatAttention', () => {
  it('aponta ausentes com o tempo parado e os offline', () => {
    const rows = [
      member('Pedro', 'online'),
      member('Gabriela Reis', 'away', { lastActiveAt: iso('2026-11-19T14:38:00') }),
      member('Rafael', 'offline'),
    ];
    expect(formatAttention(rows, NOW)).toBe('Gabriela ausente há 22 min · Rafael offline');
  });

  it('diz "nenhum" quando todos estão online', () => {
    expect(formatAttention([member('Pedro', 'online')], NOW)).toBe('nenhum');
  });
});

describe('formatWaiting', () => {
  it('total e quebra por dono, "sem dono" por último no empate', () => {
    const waits = [
      { agentName: 'Pedro Souza' },
      { agentName: 'Pedro Souza' },
      { agentName: null },
      { agentName: 'Marcella' },
      { agentName: null },
    ];
    expect(formatWaiting(waits)).toBe('5 (Pedro 2 · sem dono 2 · Marcella 1)');
  });

  it('diz "nenhuma" sem esperas', () => {
    expect(formatWaiting([])).toBe('nenhuma');
  });
});

describe('formatOldestWait', () => {
  it('mostra o tempo da espera mais antiga e com quem está', () => {
    const waits = [
      { agentName: 'Pedro', waitingSince: sp('2026-11-19T14:40:00') },
      { agentName: null, waitingSince: sp('2026-11-19T14:12:00') },
    ];
    expect(formatOldestWait(waits, NOW)).toBe('48 min (sem dono)');
  });

  it('passa de uma hora no formato 2h10', () => {
    const waits = [{ agentName: 'Pedro Souza', waitingSince: sp('2026-11-19T12:50:00') }];
    expect(formatOldestWait(waits, NOW)).toBe('2h10 (Pedro)');
  });

  it('diz "nenhuma" sem esperas', () => {
    expect(formatOldestWait([], NOW)).toBe('nenhuma');
  });
});

describe('formatBreaches', () => {
  it('total e por dono', () => {
    expect(formatBreaches([{ agentName: 'Pedro' }, { agentName: null }, { agentName: 'Pedro' }])).toBe(
      '3 (Pedro 2 · sem dono 1)',
    );
  });

  it('diz "nenhum" sem estouro', () => {
    expect(formatBreaches([])).toBe('nenhum');
  });
});

describe('formatLeads', () => {
  it('separa com a Aline, na fila e com vendedor', () => {
    expect(formatLeads({ total: 9, withAi: 4, inQueue: 3 })).toBe('9 (4 com a Aline · 3 na fila · 2 com vendedor)');
  });

  it('omite as partes zeradas', () => {
    expect(formatLeads({ total: 7, withAi: 4, inQueue: 3 })).toBe('7 (4 com a Aline · 3 na fila)');
  });

  it('só o total quando não há quebra', () => {
    expect(formatLeads({ total: 12 })).toBe('12');
  });

  it('diz "nenhum" com zero', () => {
    expect(formatLeads({ total: 0, withAi: 0, inQueue: 0 })).toBe('nenhum');
  });
});

describe('formatDayClock', () => {
  it('entrada, saída (último uso) e tempo ativo, pela ordem de entrada', () => {
    const days = [
      {
        name: 'Marcella Lima',
        day: {
          firstSeenAt: iso('2026-11-19T14:05:00'),
          lastActiveAt: iso('2026-11-19T21:58:00'),
          lastSeenAt: iso('2026-11-19T22:00:00'),
          activeMinutes: 400,
        },
      },
      {
        name: 'Pedro Souza',
        day: {
          firstSeenAt: iso('2026-11-19T09:02:00'),
          lastActiveAt: null,
          lastSeenAt: iso('2026-11-19T18:11:00'),
          activeMinutes: 425,
        },
      },
      { name: 'Rafael', day: null },
    ];
    expect(formatDayClock(days, TZ)).toBe(
      'Pedro 09:02–18:11 (ativo 7h05) · Marcella 14:05–21:58 (ativo 6h40)',
    );
  });

  it('diz "ninguém entrou hoje" sem ponto', () => {
    expect(formatDayClock([{ name: 'Rafael', day: null }], TZ)).toBe('ninguém entrou hoje');
  });
});
