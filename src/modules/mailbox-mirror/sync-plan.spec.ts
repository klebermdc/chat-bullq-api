import { chunk, cursorAfterEmptyScan, pendingUids, planSync } from './sync-plan';

const NOW = new Date('2026-11-15T12:00:00Z');

describe('planSync', () => {
  it('primeira vez: busca os últimos 12 meses a partir do UID 0', () => {
    const plan = planSync({ uidValidity: null, lastUid: 0n }, 777n, NOW);

    expect(plan.mode).toBe('initial');
    expect(plan.afterUid).toBe(0n);
    expect(plan.search).toEqual({ since: new Date('2025-11-15T12:00:00Z') });
  });

  it('mesma uidValidity: só UIDs depois do último visto', () => {
    const plan = planSync({ uidValidity: 777n, lastUid: 1500n }, 777n, NOW);

    expect(plan.mode).toBe('incremental');
    expect(plan.afterUid).toBe(1500n);
    expect(plan.search).toEqual({ uid: '1501:*' });
  });

  it('uidValidity mudou: recomeça os 12 meses (idempotente pelo Message-ID)', () => {
    const plan = planSync({ uidValidity: 777n, lastUid: 1500n }, 900n, NOW);

    expect(plan.mode).toBe('reset');
    expect(plan.afterUid).toBe(0n);
    expect(plan.search).toEqual({ since: new Date('2025-11-15T12:00:00Z') });
  });
});

describe('pendingUids', () => {
  it('ordena, tira os já vistos (o "n:*" do IMAP sempre devolve o último) e limita', () => {
    expect(pendingUids([1500, 1503, 1501, 1502], 1500n, 2)).toEqual([1501, 1502]);
  });

  it('lista vazia quando nada é novo', () => {
    expect(pendingUids([1500], 1500n, 10)).toEqual([]);
  });
});

describe('cursorAfterEmptyScan', () => {
  it('na primeira vez sem nada nos 12 meses, pula para o fim da pasta', () => {
    expect(cursorAfterEmptyScan('initial', 0n, 4321)).toBe(4320n);
  });

  it('no incremental mantém o cursor', () => {
    expect(cursorAfterEmptyScan('incremental', 10n, 4321)).toBe(10n);
  });

  it('nunca anda para trás', () => {
    expect(cursorAfterEmptyScan('reset', 5000n, 4321)).toBe(5000n);
  });
});

describe('chunk', () => {
  it('quebra em lotes do tamanho pedido', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});
