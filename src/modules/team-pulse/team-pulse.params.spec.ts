import { buildClosingParams, buildHourlyParams, PULSE_PARAM_MAX } from './team-pulse.params';

const sp = (isoLocal: string) => new Date(`${isoLocal}-03:00`);
const TZ = 'America/Sao_Paulo';
const NOW = sp('2026-11-19T15:00:00');

describe('buildHourlyParams', () => {
  it('monta as 8 variáveis na ordem do template', () => {
    // Arrange
    const input = {
      now: NOW,
      tz: TZ,
      members: [
        {
          name: 'Pedro Souza',
          status: 'online' as const,
          lastActiveAt: NOW.toISOString(),
          today: { firstSeenAt: sp('2026-11-19T09:02:00').toISOString() },
        },
        { name: 'Rafael', status: 'offline' as const, lastActiveAt: null, today: { firstSeenAt: null } },
      ],
      waits: [{ agentName: 'Pedro Souza', waitingSince: sp('2026-11-19T14:12:00') }],
      breaches: [],
      leads: { total: 7, withAi: 4, inQueue: 3 },
    };
    // Act
    const params = buildHourlyParams(input);
    // Assert
    expect(params).toEqual([
      '15h · qui 19/11',
      '1 online · 1 offline',
      'Pedro (desde 09:02)',
      'Rafael offline',
      '1 (Pedro 1)',
      '48 min (Pedro)',
      'nenhum',
      '7 (4 com a Aline · 3 na fila)',
    ]);
  });

  it('corta variável longa com "…" e nunca deixa quebra de linha', () => {
    const members = Array.from({ length: 30 }, (_, i) => ({
      name: `Atendente${i}\nX`,
      status: 'online' as const,
      lastActiveAt: NOW.toISOString(),
      today: { firstSeenAt: null },
    }));
    const params = buildHourlyParams({ now: NOW, tz: TZ, members, waits: [], breaches: [], leads: { total: 0 } });
    expect(params[2].length).toBeLessThanOrEqual(PULSE_PARAM_MAX);
    expect(params[2].endsWith('…')).toBe(true);
    expect(params.some((p) => /[\n\t]| {4,}/.test(p))).toBe(false);
  });
});

describe('buildClosingParams', () => {
  it('monta as 5 variáveis na ordem do template', () => {
    const params = buildClosingParams({
      now: sp('2026-11-19T22:00:00'),
      tz: TZ,
      days: [
        {
          name: 'Pedro Souza',
          day: {
            firstSeenAt: sp('2026-11-19T09:02:00').toISOString(),
            lastActiveAt: sp('2026-11-19T18:11:00').toISOString(),
            lastSeenAt: sp('2026-11-19T18:15:00').toISOString(),
            activeMinutes: 425,
          },
        },
      ],
      waits: [],
      breaches: [{ agentName: 'Pedro' }],
      leads: { total: 31 },
    });
    expect(params).toEqual([
      'qui 19/11',
      'Pedro 09:02–18:11 (ativo 7h05)',
      'nenhuma',
      '1 (Pedro 1)',
      '31',
    ]);
  });
});
