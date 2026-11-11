import { formatOfflineAlert, formatQueueAlert, formatSlaAlert, selectOfflineAgents, type PresenceLine } from './manager-bot.alerts';

const NOW = new Date('2026-11-11T15:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

function person(name: string, over: Partial<PresenceLine> = {}): PresenceLine {
  return {
    userId: name,
    name,
    status: 'offline',
    lastActiveAt: minutesAgo(45),
    schedule: { configured: true, withinHours: true },
    ...over,
  };
}

describe('formatSlaAlert', () => {
  it('nada a avisar sem atrasos', () => {
    expect(formatSlaAlert([], 30)).toBeNull();
  });
  it('lista os atrasados com minutos úteis', () => {
    const text = formatSlaAlert([{ contactName: 'Ana', agentName: null, businessMinutes: 75 }], 30);
    expect(text).toContain('1 cliente(s) esperando há mais de 30 min');
    expect(text).toContain('• Ana — sem dono — 1h15 úteis');
  });
});

describe('formatQueueAlert', () => {
  it('só avisa acima do limite', () => {
    expect(formatQueueAlert(10, null, 10, NOW)).toBeNull();
    expect(formatQueueAlert(11, minutesAgo(90), 10, NOW)).toBe(
      '📥 <b>Fila sem dono com 11 conversas</b>, a mais antiga há 1h30. Vale distribuir.',
    );
  });
});

describe('selectOfflineAgents', () => {
  it('pega só offline, com expediente, dentro do horário e parado há N min', () => {
    const rows = [
      person('Sim'),
      person('NuncaEntrou', { lastActiveAt: null }),
      person('Online', { status: 'online' }),
      person('Ausente', { status: 'away' }),
      person('ForaDoHorario', { schedule: { configured: true, withinHours: false } }),
      person('SemAgenda', { schedule: { configured: false, withinHours: null } }),
      person('Recente', { lastActiveAt: minutesAgo(10) }),
    ];
    expect(selectOfflineAgents(rows, NOW, 30).map((r) => r.name)).toEqual(['Sim', 'NuncaEntrou']);
  });

  it('texto do alerta', () => {
    const text = formatOfflineAlert([person('Pedro'), person('Bia', { lastActiveAt: null })], NOW);
    expect(text).toContain('• Pedro — visto há 45 min');
    expect(text).toContain('• Bia — não entrou hoje');
    expect(formatOfflineAlert([], NOW)).toBeNull();
  });
});
