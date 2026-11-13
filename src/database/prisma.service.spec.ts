import { PRISMA_CLIENT_OPTIONS, PrismaService } from './prisma.service';

interface CapturedQuery {
  modelName: string;
  action: string;
  query: { selection: Record<string, unknown> };
}

interface FakeEngine {
  request: (query: CapturedQuery) => Promise<never>;
  start: () => Promise<void>;
  transaction: (action: string) => Promise<{ id: string } | undefined>;
}

const ENGINE_STOP = 'engine-stopped';

/** Sem banco: o motor só registra a consulta montada pelo client e aborta. */
function createServiceWithSpyEngine(): { service: PrismaService; queries: CapturedQuery[] } {
  process.env.DATABASE_URL ??= 'postgresql://user:pass@127.0.0.1:1/none';
  const service = new PrismaService();
  const queries: CapturedQuery[] = [];
  const engine = (service as unknown as { _engine: FakeEngine })._engine;
  engine.request = async (query) => {
    queries.push(query);
    throw new Error(ENGINE_STOP);
  };
  engine.start = async () => undefined;
  engine.transaction = async (action) => (action === 'start' ? { id: 'tx1' } : undefined);
  return { service, queries };
}

const swallowEngineStop = async (run: () => Promise<unknown>) => {
  await run().catch((err: Error) => {
    if (err.message !== ENGINE_STOP) throw err;
  });
};

const contactSelection = (query: CapturedQuery, path: string[] = []): Record<string, unknown> =>
  path.reduce<Record<string, unknown>>(
    (sel, key) => (sel[key] as { selection: Record<string, unknown> }).selection,
    query.query.selection,
  );

describe('PrismaService', () => {
  test('opções omitem a marca de cliente oculto do contato', () => {
    expect(PRISMA_CLIENT_OPTIONS.omit.contact.isMysteryShopper).toBe(true);
  });

  test('include de contato em outro model sai sem isMysteryShopper', async () => {
    const { service, queries } = createServiceWithSpyEngine();

    await swallowEngineStop(() => service.conversation.findMany({ include: { contact: true } }));

    expect(queries).toHaveLength(1);
    expect(contactSelection(queries[0], ['contact'])).toMatchObject({ isMysteryShopper: false });
  });

  test('contato lido dentro de $transaction interativa também omite o campo', async () => {
    const { service, queries } = createServiceWithSpyEngine();

    await swallowEngineStop(() => service.$transaction(async (tx) => tx.contact.findFirst({})));

    expect(queries).toHaveLength(1);
    expect(contactSelection(queries[0])).toMatchObject({ isMysteryShopper: false });
  });
});
