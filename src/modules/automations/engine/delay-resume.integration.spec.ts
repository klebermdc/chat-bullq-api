import { AutomationRunStatus } from '@prisma/client';
import { AutomationExecutorService } from './automation-executor.service';

// Fakes mínimos ----------------------------------------------------------
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

// Registry: send_message e add_tag "ok"; delay devolve control.
function fakeRegistry() {
  const calls: string[] = [];
  return {
    calls,
    get: (type: string) => {
      if (type === 'delay') {
        return {
          type: 'delay',
          continueOnErrorDefault: false,
          validateParams: () => undefined,
          execute: async () => {
            calls.push('delay');
            return {
              ok: true,
              control: {
                type: 'delay',
                resumeAt: new Date(Date.now() + 3_600_000).toISOString(),
              },
              output: {},
            };
          },
        };
      }
      return {
        type,
        continueOnErrorDefault: type === 'send_message',
        validateParams: () => undefined,
        execute: async () => {
          calls.push(type);
          return { ok: true, output: {} };
        },
      };
    },
  };
}

describe('delay + resume (integração do executor)', () => {
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
      { type: 'delay', params: { unit: 'hours', value: 1 } },
      { type: 'add_tag', params: { tagId: 't1', target: 'contact' } },
    ],
  };

  const job: any = {
    outboxEventId: 'ob1',
    organizationId: 'org1',
    trigger: 'MESSAGE_RECEIVED',
    traceId: 'trace1',
    cascadeDepth: 0,
    visitedAutomations: [],
    payload: { organizationId: 'org1', contactId: 'c1', conversationId: 'cv1' },
  };

  function makeExecutor(registry: any, store: { run: any }) {
    const prisma: any = {
      automation: {
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({ consecutiveFailures: 0 }),
      },
      automationRun: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          store.run = { id: 'run1', ...data };
          return Promise.resolve({ id: 'run1' });
        }),
        update: jest.fn().mockImplementation(({ data }: any) => {
          store.run = { ...store.run, ...data };
          return Promise.resolve(store.run);
        }),
        findUnique: jest.fn().mockImplementation(() =>
          Promise.resolve({ ...store.run, automation }),
        ),
      },
    };
    const evaluator: any = { evaluate: () => true };
    const outbox: any = {};
    const redis = fakeRedis();
    const realtime = fakeRealtime();
    const exec = new AutomationExecutorService(
      prisma,
      evaluator,
      registry,
      outbox,
      redis as any,
      realtime as any,
    );
    (exec as any).checkActor = jest.fn().mockResolvedValue(true);
    return { exec, prisma, redis };
  }

  it('pausa no delay e retoma da ação seguinte', async () => {
    const registry = fakeRegistry();
    const store = { run: null as any };
    const { exec, prisma } = makeExecutor(registry, store);
    prisma.automation.findMany.mockResolvedValue([automation]);

    // 1ª passada: dispara o trigger.
    await exec.execute(job);

    // Executou send_message, viu o delay, parou. add_tag ainda NÃO rodou.
    expect(registry.calls).toEqual(['send_message', 'delay']);
    expect(store.run.status).toBe(AutomationRunStatus.WAITING);
    expect(store.run.resumeActionIndex).toBe(2);
    expect(store.run.resumeAt).toBeInstanceOf(Date);

    // 2ª passada: watchdog venceu → resumeRun.
    await exec.resumeRun({ runId: 'run1', organizationId: 'org1' });

    // Continuou da ação 2 (add_tag) e finalizou SUCCESS.
    expect(registry.calls).toEqual(['send_message', 'delay', 'add_tag']);
    expect(store.run.status).toBe(AutomationRunStatus.SUCCESS);
    expect(store.run.resumeActionIndex).toBeNull();
    expect(store.run.resumeAt).toBeNull();
  });
});
