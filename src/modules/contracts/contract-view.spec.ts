import { toDetailView, toListItem } from './contract-view';
import { CONTRACT_LIST_SELECT } from './contracts.repository';

describe('contract-view', () => {
  it('a listagem não seleciona nada do login do Planejador', () => {
    expect(CONTRACT_LIST_SELECT).not.toHaveProperty('planejadorPasswordEnc');
    expect(CONTRACT_LIST_SELECT).not.toHaveProperty('planejadorSyncedAt');
    expect(CONTRACT_LIST_SELECT).not.toHaveProperty('planejadorError');
  });

  it('toListItem tira a senha cifrada mesmo se ela vier na linha', () => {
    const r = toListItem({ id: 'c1', planejadorPasswordEnc: 'v1:abc' } as any);
    expect(r).not.toHaveProperty('planejadorPasswordEnc');
  });

  it('detalhe tira a senha cifrada e mantém o estado do Planejador', () => {
    const syncedAt = new Date('2026-10-16T12:00:00Z');
    const r = toDetailView({
      id: 'c1', clientUserAgent: 'UA', planejadorPasswordEnc: 'v1:abc', planejadorSyncedAt: syncedAt,
      planejadorError: 'timeout',
    });
    expect(r).not.toHaveProperty('planejadorPasswordEnc');
    expect(r).not.toHaveProperty('clientUserAgent');
    expect(r).toMatchObject({ id: 'c1', planejadorSyncedAt: syncedAt, planejadorError: 'timeout' });
  });
});
