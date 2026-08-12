import { MarketingSyncCron } from './marketing-sync.cron';
import { MARKETING_SYNC_CRON_PATTERN, MARKETING_SYNC_WINDOW_DAYS } from '../marketing.constants';

function build(active: { id: string }[] = [{ id: 'conn-1' }, { id: 'conn-2' }]) {
  const repo = { findActive: jest.fn(async () => active) };
  // Parametros anotados explicitamente (em vez de `() => undefined`): sem
  // eles o jest.fn() infere um mock de zero argumentos, e `.mock.calls[0][0]`
  // mais abaixo vira uma tupla `[]` — erro de compilacao, nao de teste.
  const syncQueue = { enqueueSync: jest.fn(async (_data: any) => undefined) };
  const cronQueue = {
    add: jest.fn(async (_name: string, _payload: any, _opts: any) => undefined),
  };
  const cron = new MarketingSyncCron(repo as any, syncQueue as any, cronQueue as any);
  return { cron, repo, syncQueue, cronQueue };
}

describe('MarketingSyncCron', () => {
  it('registra o repeat no boot', async () => {
    const { cron, cronQueue } = build();
    await cron.onModuleInit();
    const [, , opts] = cronQueue.add.mock.calls[0];
    expect(opts.repeat).toEqual({ pattern: MARKETING_SYNC_CRON_PATTERN });
    expect(opts.jobId).toBe('marketing-sync-cron');
  });

  it('nao derruba o boot se o registro do repeat falhar', async () => {
    const { cron, cronQueue } = build();
    cronQueue.add.mockRejectedValueOnce(new Error('redis fora'));
    await expect(cron.onModuleInit()).resolves.toBeUndefined();
  });

  it('enfileira um sync por conexao ativa', async () => {
    const { cron, syncQueue } = build();
    await cron.process({} as any);
    expect(syncQueue.enqueueSync).toHaveBeenCalledTimes(2);
    expect(syncQueue.enqueueSync.mock.calls.map((c) => c[0].connectionId)).toEqual([
      'conn-1',
      'conn-2',
    ]);
  });

  it('usa a janela movel e a razao daily', async () => {
    const { cron, syncQueue } = build([{ id: 'conn-1' }]);
    await cron.process({} as any);
    const arg = syncQueue.enqueueSync.mock.calls[0][0];
    expect(arg.reason).toBe('daily');

    const since = new Date(`${arg.since}T00:00:00Z`);
    const until = new Date(`${arg.until}T00:00:00Z`);
    const dias = Math.round((until.getTime() - since.getTime()) / 86400000);
    expect(dias).toBe(MARKETING_SYNC_WINDOW_DAYS);
  });

  it('sem conexao ativa nao enfileira nada', async () => {
    const { cron, syncQueue } = build([]);
    await cron.process({} as any);
    expect(syncQueue.enqueueSync).not.toHaveBeenCalled();
  });

  it('falha ao enfileirar uma conexao nao impede as demais', async () => {
    const { cron, syncQueue } = build();
    syncQueue.enqueueSync.mockRejectedValueOnce(new Error('redis fora'));
    await expect(cron.process({} as any)).resolves.toBeUndefined();
    expect(syncQueue.enqueueSync).toHaveBeenCalledTimes(2);
  });
});
