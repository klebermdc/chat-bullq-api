import { AutomationRunStatus } from '@prisma/client';
import { AutomationExecutorService } from './automation-executor.service';

function fakeRedis() {
  return {
    tryConsumeRateLimit: jest.fn().mockResolvedValue(true),
    acquireContactLock: jest.fn().mockResolvedValue('tok'),
    releaseContactLock: jest.fn().mockResolvedValue(undefined),
  };
}
function fakeRealtime() {
  return { emitToOrg: jest.fn() };
}

// send_message tem checkpoint=true; add_tag não.
function fakeRegistry() {
  const calls: string[] = [];
  return {
    calls,
    get: (type: string) => ({
      type,
      continueOnErrorDefault: type === 'send_message',
      checkpoint: type === 'send_message' ? true : undefined,
      validateParams: () => undefined,
      execute: async () => {
        calls.push(type);
        return { ok: true, output: {} };
      },
    }),
  };
}

const automation: any = {
  id: 'auto1',
  organizationId: 'org1',
  actorId: 'actor1',
  schemaVersion: 1,
  enabled: true,
  deletedAt: null,
  conditions: {},
  rateLimitPerMinute: 10,
  actions: [
    { type: 'send_message', params: {}, continueOnError: true },
    { type: 'add_tag', params: { tagId: 't1', target: 'contact' } },
  ],
};

function makeExecutor(registry: any, store: { run: any; updates: any[] }) {
  const prisma: any = {
    automation: {
      findMany: jest.fn().mockResolvedValue([automation]),
      update: jest.fn().mockResolvedValue({ consecutiveFailures: 0 }),
    },
    automationRun: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        store.run = { id: 'run1', ...data };
        return Promise.resolve({ id: 'run1' });
      }),
      update: jest.fn().mockImplementation(({ data }: any) => {
        store.updates.push(data);
        store.run = { ...store.run, ...data };
        return Promise.resolve(store.run);
      }),
      findUnique: jest.fn().mockImplementation(() =>
        Promise.resolve({ ...store.run, automation }),
      ),
    },
  };
  const evaluator: any = { evaluate: () => true };
  const exec = new AutomationExecutorService(
    prisma,
    evaluator,
    registry,
    {} as any,
    fakeRedis() as any,
    fakeRealtime() as any,
  );
  (exec as any).checkActor = jest.fn().mockResolvedValue(true);
  return { exec };
}

const job: any = {
  outboxEventId: 'ob1',
  organizationId: 'org1',
  trigger: 'MESSAGE_RECEIVED',
  traceId: 'trace1',
  cascadeDepth: 0,
  visitedAutomations: [],
  payload: { organizationId: 'org1', contactId: 'c1', conversationId: 'cv1' },
};

describe('checkpoint (integração do executor)', () => {
  it('grava checkpoint (resumeActionIndex avançado, sem status terminal) após send_message', async () => {
    const registry = fakeRegistry();
    const store = { run: null as any, updates: [] as any[] };
    const { exec } = makeExecutor(registry, store);

    await exec.execute(job);

    const checkpoint = store.updates.find(
      (u) => u.resumeActionIndex === 1 && u.status === undefined,
    );
    expect(checkpoint).toBeDefined();
    expect(store.run.status).toBe(AutomationRunStatus.SUCCESS);
    expect(registry.calls).toEqual(['send_message', 'add_tag']);
  });

  it('resume a partir do checkpoint NÃO re-executa o send_message já enviado', async () => {
    const registry = fakeRegistry();
    const store = {
      run: {
        id: 'run1',
        organizationId: 'org1',
        traceId: 'trace1',
        status: AutomationRunStatus.WAITING,
        resumeAt: new Date(Date.now() - 1000),
        resumeActionIndex: 1,
        resumeState: { cascadeDepth: 1, visitedAutomations: ['auto1'] },
        triggerPayload: {
          organizationId: 'org1',
          contactId: 'c1',
          conversationId: 'cv1',
        },
        actionsLog: [
          { index: 0, type: 'send_message', status: 'success', durationMs: 1 },
        ],
      },
      updates: [] as any[],
    };
    const { exec } = makeExecutor(registry, store);

    await exec.resumeRun({ runId: 'run1', organizationId: 'org1' });

    expect(registry.calls).toEqual(['add_tag']);
    expect(store.run.status).toBe(AutomationRunStatus.SUCCESS);
  });
});
