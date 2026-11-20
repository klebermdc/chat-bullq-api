import { RecentDisconnects } from './recent-disconnects';
import { ACTIVE_WINDOW_MS } from './presence.util';

const NOW = new Date('2026-11-20T12:00:00Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe('RecentDisconnects', () => {
  it('mantém quem caiu há pouco (celular foi pro WhatsApp e volta)', () => {
    const recent = new RecentDisconnects();
    recent.record({ organizationId: 'org', userId: 'u1', lastActiveAt: ago(60_000) });

    expect(recent.list(NOW)).toEqual([
      { organizationId: 'org', userId: 'u1', lastActiveAt: ago(60_000) },
    ]);
  });

  it('solta quem não mexe há mais que a janela de ativo', () => {
    const recent = new RecentDisconnects();
    recent.record({ organizationId: 'org', userId: 'u1', lastActiveAt: ago(ACTIVE_WINDOW_MS + 1) });

    expect(recent.list(NOW)).toEqual([]);
  });

  it('guarda só a atividade mais recente por atendente e org', () => {
    const recent = new RecentDisconnects();
    recent.record({ organizationId: 'org', userId: 'u1', lastActiveAt: ago(30_000) });
    recent.record({ organizationId: 'org', userId: 'u1', lastActiveAt: ago(120_000) });

    expect(recent.list(NOW)).toEqual([
      { organizationId: 'org', userId: 'u1', lastActiveAt: ago(30_000) },
    ]);
  });

  it('ignora socket sem atendente ou org (handshake não terminou)', () => {
    const recent = new RecentDisconnects();
    recent.record({ organizationId: undefined, userId: 'u1', lastActiveAt: ago(1_000) });
    recent.record({ organizationId: 'org', userId: undefined, lastActiveAt: ago(1_000) });

    expect(recent.list(NOW)).toEqual([]);
  });

  it('limpa as entradas vencidas ao listar', () => {
    const recent = new RecentDisconnects();
    recent.record({ organizationId: 'org', userId: 'u1', lastActiveAt: ago(ACTIVE_WINDOW_MS + 1) });
    recent.list(NOW);

    expect(recent.size()).toBe(0);
  });
});
