import { ACTIVE_WINDOW_MS, dayKey, groupPresence, presenceStatus } from './presence.util';

const NOW = new Date('2026-09-22T15:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe('groupPresence', () => {
  it('junta as abas do mesmo atendente e fica com a atividade mais recente', () => {
    const result = groupPresence([
      { organizationId: 'org-1', userId: 'pedro', lastActiveAt: minutesAgo(30) },
      { organizationId: 'org-1', userId: 'pedro', lastActiveAt: minutesAgo(2) },
      { organizationId: 'org-1', userId: 'renata', lastActiveAt: minutesAgo(10) },
    ]);

    expect(result).toEqual([
      { organizationId: 'org-1', userId: 'pedro', lastActiveAt: minutesAgo(2) },
      { organizationId: 'org-1', userId: 'renata', lastActiveAt: minutesAgo(10) },
    ]);
  });

  it('ignora conexão sem atendente ou sem organização (handshake incompleto)', () => {
    const result = groupPresence([
      { organizationId: undefined, userId: 'pedro', lastActiveAt: NOW },
      { organizationId: 'org-1', userId: undefined, lastActiveAt: NOW },
    ]);

    expect(result).toEqual([]);
  });

  it('separa o mesmo atendente em organizações diferentes', () => {
    const result = groupPresence([
      { organizationId: 'org-1', userId: 'pedro', lastActiveAt: NOW },
      { organizationId: 'org-2', userId: 'pedro', lastActiveAt: NOW },
    ]);

    expect(result).toHaveLength(2);
  });
});

describe('presenceStatus', () => {
  it('online quando mexeu no Chat dentro da janela de atividade', () => {
    expect(presenceStatus(minutesAgo(1), NOW)).toBe('online');
  });

  it('ausente quando o Chat está aberto mas parado', () => {
    expect(presenceStatus(new Date(NOW.getTime() - ACTIVE_WINDOW_MS - 1000), NOW)).toBe('away');
  });

  it('offline quando não há conexão', () => {
    expect(presenceStatus(null, NOW)).toBe('offline');
  });
});

describe('dayKey', () => {
  it('usa o dia no fuso da organização, não o dia em UTC', () => {
    // 02:30 UTC de 23/09 ainda é 22/09 em São Paulo (23:30).
    expect(dayKey(new Date('2026-09-23T02:30:00Z'), 'America/Sao_Paulo')).toBe('2026-09-22');
  });
});
