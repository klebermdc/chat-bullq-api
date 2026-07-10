# Endurecer Durabilidade do Motor `automations` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar os 2 gaps de durabilidade do review do PR #35 — órfã `WAITING` em crash (varredura → FAILED) e duplicação de `send_message` no resume (checkpoint após ações de efeito externo).

**Architecture:** Aditivo sobre a branch `feat/automations-delay-durable`, sem migração (reusa `AutomationRun.resumeAt/resumeActionIndex` do #35). Fix 1 estende o `AutomationResumeWatchdogCron` com um 2º scan. Fix 2 adiciona um flag `checkpoint?` ao `ActionHandler` (só `send_message` liga) e um `checkpointRun` que grava progresso após ações checkpoint-flagged.

**Tech Stack:** NestJS, Prisma, BullMQ, Jest (`ts-jest`). Testes: `yarn test <arquivo>`. Sem DB no ambiente (todos os testes são unit/mock). Typecheck baseline já falha em `inbound-message.observer.spec.ts` (arity 17vs18) — pré-existente, ignorar; nenhum outro erro é aceitável.

---

## Task 1: Fix 1 — Varredura de órfãs `WAITING` no watchdog

**Files:**
- Modify: `src/modules/automations/automations.constants.ts`
- Modify: `src/modules/automations/workers/automation-resume-watchdog.cron.ts`
- Test: `src/modules/automations/workers/automation-resume-watchdog.cron.spec.ts`

- [ ] **Step 1: Constante do threshold**

Append em `automations.constants.ts`:
```ts
// Runs em progresso (WAITING + resumeAt=null) mais velhos que isto são
// considerados órfãos de crash e reconciliados para FAILED pelo watchdog.
// 10min é folga enorme sobre qualquer cadeia síncrona de ações (incl. HTTP).
export const STALE_RUN_THRESHOLD_MS = 10 * 60 * 1000;
```

- [ ] **Step 2: Escrever o teste do sweep (falhando)**

Adicionar ao final de `automation-resume-watchdog.cron.spec.ts` (mantendo os testes existentes):
```ts
describe('AutomationResumeWatchdogCron.sweepStaleRuns', () => {
  const now = new Date('2026-07-10T12:00:00.000Z');

  function makeCron(count: number) {
    const prisma = {
      automationRun: {
        updateMany: jest.fn().mockResolvedValue({ count }),
      },
    };
    const resumeQueue = { add: jest.fn() };
    const watchdogQueue = { add: jest.fn() };
    const cron = new AutomationResumeWatchdogCron(
      prisma as any,
      resumeQueue as any,
      watchdogQueue as any,
    );
    return { cron, prisma };
  }

  it('marca FAILED órfãs WAITING+resumeAt=null mais velhas que o threshold', async () => {
    const { cron, prisma } = makeCron(3);
    const n = await cron.sweepStaleRuns(now);
    expect(n).toBe(3);
    expect(prisma.automationRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: AutomationRunStatus.WAITING,
          resumeAt: null,
          startedAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) },
        }),
        data: expect.objectContaining({
          status: AutomationRunStatus.FAILED,
          errorCode: 'stale_in_progress',
        }),
      }),
    );
  });

  it('retorna 0 quando não há órfãs', async () => {
    const { cron } = makeCron(0);
    expect(await cron.sweepStaleRuns(now)).toBe(0);
  });
});
```

- [ ] **Step 3: Rodar, ver falhar**

Run: `yarn test automation-resume-watchdog`
Expected: FAIL — `sweepStaleRuns` não existe.

- [ ] **Step 4: Implementar `sweepStaleRuns` + wire no `process()`**

Em `automation-resume-watchdog.cron.ts`:

(a) Importar a constante (juntar ao import existente de `../automations.constants`):
```ts
import {
  AUTOMATION_RESUME_QUEUE,
  AUTOMATION_RESUME_WATCHDOG_QUEUE,
  AUTOMATION_RESUME_WATCHDOG_JOB,
  RESUME_WATCHDOG_PATTERN,
  RESUME_CLAIM_BATCH_SIZE,
  STALE_RUN_THRESHOLD_MS,
} from '../automations.constants';
```

(b) Substituir o `process()` atual por (roda os dois scans no mesmo tick):
```ts
  async process(_job: Job): Promise<void> {
    const now = new Date();
    await this.claimAndEnqueueDueRuns(now);
    await this.sweepStaleRuns(now);
  }
```

(c) Adicionar o método (depois de `claimAndEnqueueDueRuns`):
```ts
  // Reconcilia órfãs: runs criados como WAITING+resumeAt=null cujo processo
  // morreu antes de pausar/finalizar. O scan de resume nunca os toca (filtra
  // resumeAt<=now, e null nunca casa), então sem isto ficariam WAITING para
  // sempre. Marca FAILED após STALE_RUN_THRESHOLD_MS, preservando o log
  // parcial. Testável isoladamente; retorna quantos foram varridos.
  async sweepStaleRuns(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - STALE_RUN_THRESHOLD_MS);
    const { count } = await this.prisma.automationRun.updateMany({
      where: {
        status: AutomationRunStatus.WAITING,
        resumeAt: null,
        startedAt: { lt: cutoff },
      },
      data: {
        status: AutomationRunStatus.FAILED,
        errorCode: 'stale_in_progress',
        errorMessage:
          'run em progresso abandonado (crash antes de pausar/finalizar)',
        finishedAt: now,
      },
    });
    if (count > 0) {
      this.logger.warn(`varridos ${count} run(s) órfão(s) → FAILED`);
    }
    return count;
  }
```

- [ ] **Step 5: Rodar, ver passar**

Run: `yarn test automation-resume-watchdog`
Expected: PASS (os 2 antigos de `claimAndEnqueueDueRuns` + os 2 novos = 4).

- [ ] **Step 6: Verificar**

Run: `yarn typecheck`
Expected: só o erro pré-existente `inbound-message.observer.spec.ts`.

- [ ] **Step 7: Commit**
```bash
git add src/modules/automations/automations.constants.ts src/modules/automations/workers/automation-resume-watchdog.cron.ts src/modules/automations/workers/automation-resume-watchdog.cron.spec.ts
git commit -m "feat(automations): watchdog varre órfãs WAITING (crash) → FAILED"
```

---

## Task 2: Fix 2a — Flag `checkpoint` na interface + `send_message`

**Files:**
- Modify: `src/modules/automations/actions/action.types.ts`
- Modify: `src/modules/automations/actions/handlers/send-message.handler.ts`

- [ ] **Step 1: Adicionar o campo opcional à interface `ActionHandler`**

Em `action.types.ts`, dentro de `interface ActionHandler`, após `readonly continueOnErrorDefault: boolean;`, adicionar:
```ts
  // Quando true, o executor grava um checkpoint (resumeActionIndex+log)
  // logo após esta ação ter sucesso, para que um crash retome da PRÓXIMA
  // ação em vez de re-executar esta. Ligar apenas em ações com efeito
  // colateral EXTERNO irreversível (send_message, http_request). Ações
  // internas idempotentes (add_tag via @@unique) não precisam. Ausente =
  // false.
  readonly checkpoint?: boolean;
```

- [ ] **Step 2: Ligar em `SendMessageHandler`**

Em `send-message.handler.ts`, logo após `readonly continueOnErrorDefault = true;`, adicionar:
```ts
  // Efeito externo irreversível (envia mensagem real). Checkpoint garante
  // que um crash pós-envio não re-envie no resume.
  readonly checkpoint = true;
```

- [ ] **Step 3: Verificar (sem quebrar nada; sem teste próprio — coberto na Task 3)**

Run: `yarn test send-message` (se não houver spec, tudo bem — apenas confirme abaixo)
Run: `yarn typecheck`
Expected: só o erro pré-existente `inbound-message.observer.spec.ts`. Os demais handlers não declaram `checkpoint`, o que é válido (campo opcional → undefined).

- [ ] **Step 4: Commit**
```bash
git add src/modules/automations/actions/action.types.ts src/modules/automations/actions/handlers/send-message.handler.ts
git commit -m "feat(automations): flag checkpoint no ActionHandler (send_message=true)"
```

---

## Task 3: Fix 2b — `checkpointRun` + wire no `runActionsFrom` + testes de integração

**Files:**
- Modify: `src/modules/automations/engine/automation-executor.service.ts`
- Test: `src/modules/automations/engine/checkpoint.integration.spec.ts` (novo)

- [ ] **Step 1: Escrever os testes de integração (falhando)**

Criar `src/modules/automations/engine/checkpoint.integration.spec.ts`:
```ts
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

    // Um dos updates ANTES do finalize deve ser o checkpoint: resumeActionIndex=1
    // e SEM status (checkpoint não muda status).
    const checkpoint = store.updates.find(
      (u) => u.resumeActionIndex === 1 && u.status === undefined,
    );
    expect(checkpoint).toBeDefined();
    // Terminou SUCCESS no fim.
    expect(store.run.status).toBe(AutomationRunStatus.SUCCESS);
    expect(registry.calls).toEqual(['send_message', 'add_tag']);
  });

  it('resume a partir do checkpoint NÃO re-executa o send_message já enviado', async () => {
    const registry = fakeRegistry();
    // Seed: run que crashou após send_message(0) — WAITING, resumeActionIndex=1,
    // com o log parcial do send_message.
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

    // Só add_tag rodou; send_message NÃO foi re-executado.
    expect(registry.calls).toEqual(['add_tag']);
    expect(store.run.status).toBe(AutomationRunStatus.SUCCESS);
  });
});
```

- [ ] **Step 2: Rodar, ver falhar**

Run: `yarn test checkpoint.integration`
Expected: FAIL — o 1º teste falha porque nenhum `update` com `resumeActionIndex:1` sem status é emitido (checkpointRun ainda não existe). (O 2º teste pode até passar, pois já resume de index 1 — mas o 1º trava.)

- [ ] **Step 3: Implementar `checkpointRun` + chamada no `runActionsFrom`**

Em `automation-executor.service.ts`:

(a) Dentro de `runActionsFrom`, no bloco de sucesso (o `if (result.ok) { log.push({...success}); }` que vem DEPOIS do early-return do delay), adicionar a chamada de checkpoint logo após o `log.push`:
```ts
        if (result.ok) {
          log.push({
            index: i,
            type: action.type,
            status: 'success',
            durationMs: dur,
            output: result.output,
          });
          // Checkpoint após ação de efeito externo irreversível: grava o
          // progresso para que um crash retome da PRÓXIMA ação em vez de
          // re-executar o efeito (ex.: send_message não é idempotente).
          if (handler.checkpoint === true) {
            await this.checkpointRun(runId, {
              resumeActionIndex: i + 1,
              actionsLog: log,
            });
          }
        } else {
```
(NÃO altere mais nada do loop — o `else`/`catch`/delay/finalize permanecem.)

(b) Adicionar o helper (ao lado de `pauseRun`):
```ts
  // Igual ao pauseRun, mas NÃO toca em status nem resumeAt — apenas avança
  // resumeActionIndex e persiste o log parcial. O run continua no mesmo
  // estado (WAITING; resumeAt=null se em progresso, ou o resumeAt vencido
  // se num resume ativo, mantendo-o re-reivindicável para continuar).
  // Best-effort: a ação já teve efeito; um blip aqui não deve abortar o run.
  private async checkpointRun(
    runId: string,
    data: { resumeActionIndex: number; actionsLog: ActionLogEntry[] },
  ): Promise<void> {
    try {
      const run = await this.prisma.automationRun.update({
        where: { id: runId },
        data: {
          resumeActionIndex: data.resumeActionIndex,
          actionsLog: data.actionsLog as unknown as Prisma.InputJsonValue,
        },
      });
      this.realtime.emitToOrg(run.organizationId, 'automation:run', {
        automationId: run.automationId,
        run,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to checkpoint run ${runId}: ${(err as Error).message}`,
      );
    }
  }
```

- [ ] **Step 4: Rodar, ver passar**

Run: `yarn test checkpoint.integration`
Expected: PASS (2 testes).

- [ ] **Step 5: Sem regressões**

Run: `yarn test automations`
Expected: só as 2 suites pré-existentes falham (`ai-provider-keys.integration`, `inbound-message.observer`). Reportar a linha `Tests:`.
Run: `yarn typecheck`
Expected: só o erro pré-existente.

- [ ] **Step 6: Commit**
```bash
git add src/modules/automations/engine/automation-executor.service.ts src/modules/automations/engine/checkpoint.integration.spec.ts
git commit -m "feat(automations): checkpointRun após ações checkpoint-flagged (anti-dup no resume)"
```

---

## Self-Review (feito na escrita)
- **Cobertura:** Fix 1 (sweep) = Task 1; Fix 2 flag = Task 2; Fix 2 checkpointRun+wire+testes = Task 3. ✔
- **Consistência de tipos:** `checkpoint?` (T2) lido em `runActionsFrom` (T3) como `handler.checkpoint === true`; `checkpointRun` grava só `resumeActionIndex`+`actionsLog` (não status/resumeAt), coerente com o teste `status === undefined`. `STALE_RUN_THRESHOLD_MS` (T1) usado no sweep e batido no teste com o valor literal `10*60*1000`. ✔
- **Sem placeholders.** ✔

## Riscos
| Risco | Mitigação |
|-------|-----------|
| Checkpoint adiciona 1 UPDATE por ação de efeito-externo | Só `send_message`/`http_request`; automações têm poucas ações; aceito |
| Sweep marca FAILED um run que estava só lento (>10min síncrono) | 10min é folga enorme sobre qualquer cadeia real; constante ajustável |
| `updateMany` do sweep não atualiza contadores por-automation | Aceito e documentado (casos raros de crash; telemetria sub-conta falhas) |
| Janela residual de dup (crash entre envio e checkpoint UPDATE) | Irredutível sem 2PC; encolhida de "segmento" para "1 ação"; documentada |
