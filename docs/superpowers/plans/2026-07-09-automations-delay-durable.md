# Passos Sequenciais + Delay Durável no Motor `automations` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o motor `automations` executar a lista de ações como uma sequência **pausável no tempo**: uma ação `delay` congela o run (persiste `WAITING` + `resumeAt`) e um watchdog o retoma do índice exato onde parou — sem manter processo vivo nem segurar lock durante a espera.

**Architecture:** Aproveita 100% da infra existente (outbox, lock por contato, cascade/loop guard, run logs). O `AutomationRun` ganha estado durável (`WAITING`, `resumeAt`, `resumeActionIndex`, `resumeState`). O executor cria o run row no início (RUNNING), executa ações a partir de um `startIndex`, e ao encontrar uma ação `delay` grava `WAITING` e para. Um `AutomationResumeWatchdogCron` (mesmo padrão do `RecoveryWatchdogCron`) reivindica runs vencidos (`WAITING`→`RUNNING` atômico) e enfileira jobs numa fila dedicada `AUTOMATION_RESUME_QUEUE`; o `AutomationResumeProcessor` chama `executor.resumeRun`, que reconstrói o contexto do run persistido, re-adquire o lock e continua do índice salvo.

**Tech Stack:** NestJS, Prisma (PostgreSQL), BullMQ (`@nestjs/bullmq`), Jest (`ts-jest`), Redis. Comandos: testes `yarn test`, typecheck `yarn typecheck`, migração dev `yarn prisma:migrate`.

**Escopo deliberado (YAGNI):** esta fatia NÃO adiciona passagem de variáveis entre passos, nem ramificação if/else, nem DAG visual. Só sequência linear + delay durável. Isso destrava a migração da cadência/reengajamento como automações num PR futuro.

---

## File Structure

**Modificados:**
- `prisma/schema.prisma` — enum `AutomationRunStatus` (+`WAITING`) e model `AutomationRun` (+4 campos).
- `src/modules/automations/actions/action.types.ts` — `ACTION_TYPES` (+`delay`), `ActionExecutionResult` (+`control`).
- `src/modules/automations/actions/action-registry.service.ts` — registrar `DelayHandler`.
- `src/modules/automations/automations.types.ts` — `AutomationResumeJobData`.
- `src/modules/automations/automations.constants.ts` — filas/jobs de resume + cadência do watchdog.
- `src/modules/automations/engine/automation-executor.service.ts` — `runActionsFrom`, `resumeRun`, helpers de run row.
- `src/modules/automations/automations.module.ts` — registrar handler, cron, processor e as duas filas.

**Criados:**
- `src/modules/automations/actions/handlers/delay.handler.ts`
- `src/modules/automations/actions/handlers/delay.handler.spec.ts`
- `src/modules/automations/engine/resume-context.spec.ts`
- `src/modules/automations/workers/automation-resume.processor.ts`
- `src/modules/automations/workers/automation-resume-watchdog.cron.ts`
- `src/modules/automations/workers/automation-resume-watchdog.cron.spec.ts`

---

## Task 1: Schema — estado durável no `AutomationRun`

**Files:**
- Modify: `prisma/schema.prisma` (enum `AutomationRunStatus` ~linha com `SKIPPED`; model `AutomationRun` ~linha 1736)

- [ ] **Step 1: Adicionar valor `WAITING` ao enum**

Em `prisma/schema.prisma`, no `enum AutomationRunStatus`, adicionar a última variante:

```prisma
enum AutomationRunStatus {
  SUCCESS // todas as actions executaram
  PARTIAL // uma ou mais actions falharam mas o run continuou (continueOnError)
  FAILED // run abortado (action critica falhou ou erro de infra)
  SKIPPED // condições não casaram, ou rate limit, ou kill switch
  WAITING // run pausado por uma ação `delay`, aguardando resumeAt
}
```

- [ ] **Step 2: Adicionar campos de retomada ao model `AutomationRun`**

Dentro do `model AutomationRun`, logo após o campo `finishedAt`, adicionar:

```prisma
  // ─── Retomada (ação `delay`) ────────────────────────────────────
  // Quando status = WAITING, estes campos dizem QUANDO e ONDE continuar.
  resumeAt          DateTime? @map("resume_at")
  // Índice na lista de actions por onde o run deve continuar ao acordar.
  resumeActionIndex Int?      @map("resume_action_index")
  // Snapshot do contexto de execução necessário para reconstruir o ctx no
  // resume sem depender do job original: { cascadeDepth, visitedAutomations }.
  resumeState       Json?     @map("resume_state")
```

E adicionar um índice para o watchdog varrer runs vencidos de forma barata. Junto dos outros `@@index` do model:

```prisma
  @@index([status, resumeAt], name: "idx_run_status_resume")
```

- [ ] **Step 3: Gerar a migração**

Run: `yarn prisma:migrate --name automation_run_durable_delay`
Expected: cria `prisma/migrations/<timestamp>_automation_run_durable_delay/migration.sql` com `ALTER TYPE ... ADD VALUE 'WAITING'`, 3 colunas novas e 1 índice; Prisma Client regenerado sem erro.

> Nota de deploy (não é passo agora): em produção a migração roda via `prisma migrate deploy`. `ALTER TYPE ADD VALUE` não pode rodar dentro de transação em Postgres antigo — se o deploy reclamar, aplicar o enum numa migração isolada. Registrar isso no PR.

- [ ] **Step 4: Verificar typecheck**

Run: `yarn typecheck`
Expected: PASS (o Prisma Client agora conhece `WAITING`, `resumeAt`, `resumeActionIndex`, `resumeState`).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(automations): estado durável de run (WAITING + resumeAt) para delay"
```

---

## Task 2: Tipo de sinal de controle + ação `delay`

**Files:**
- Modify: `src/modules/automations/actions/action.types.ts`
- Create: `src/modules/automations/actions/handlers/delay.handler.ts`
- Test: `src/modules/automations/actions/handlers/delay.handler.spec.ts`

- [ ] **Step 1: Escrever o teste do handler**

Criar `src/modules/automations/actions/handlers/delay.handler.spec.ts`:

```ts
import { DelayHandler } from './delay.handler';
import { ActionContext } from '../action.types';

describe('DelayHandler', () => {
  const handler = new DelayHandler();
  const ctx = {} as ActionContext; // delay não toca DB/outbox

  describe('validateParams', () => {
    it('aceita unidade e valor válidos', () => {
      expect(() => handler.validateParams({ unit: 'hours', value: 24 })).not.toThrow();
    });
    it('rejeita unidade inválida', () => {
      expect(() => handler.validateParams({ unit: 'weeks', value: 1 })).toThrow(/unit/);
    });
    it('rejeita valor <= 0', () => {
      expect(() => handler.validateParams({ unit: 'days', value: 0 })).toThrow(/value/);
    });
    it('rejeita valor não inteiro', () => {
      expect(() => handler.validateParams({ unit: 'minutes', value: 1.5 })).toThrow(/value/);
    });
  });

  describe('execute', () => {
    it('retorna control.delay com resumeAt no futuro correto', async () => {
      const before = Date.now();
      const res = await handler.execute({ unit: 'hours', value: 2 }, ctx);
      expect(res.ok).toBe(true);
      expect(res.control?.type).toBe('delay');
      const resumeMs = new Date(res.control!.resumeAt).getTime();
      // 2h = 7_200_000ms, com folga de clock
      expect(resumeMs - before).toBeGreaterThanOrEqual(7_200_000 - 50);
      expect(resumeMs - before).toBeLessThan(7_200_000 + 5_000);
    });
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `yarn test delay.handler`
Expected: FAIL — `Cannot find module './delay.handler'` e `control` não existe em `ActionExecutionResult`.

- [ ] **Step 3: Estender `ActionExecutionResult` e `ACTION_TYPES`**

Em `src/modules/automations/actions/action.types.ts`:

Adicionar `'delay'` ao array `ACTION_TYPES` (última posição):

```ts
export const ACTION_TYPES = [
  'add_tag',
  'remove_tag',
  'add_to_pipeline',
  'move_pipeline_stage',
  'assign_user',
  'send_message',
  'delay',
] as const;
```

Adicionar o tipo do sinal de controle e o campo `control` na interface `ActionExecutionResult` (logo após o campo `output?`):

```ts
// Sinal de controle de fluxo devolvido por ações especiais. Hoje só o
// `delay`: pede ao executor para persistir o run como WAITING e parar,
// retomando em `resumeAt`. O executor é o ÚNICO que age sobre isto — o
// handler não persiste nada.
export interface DelayControl {
  type: 'delay';
  resumeAt: string; // ISO-8601
}

export type ActionControl = DelayControl;
```

Dentro de `interface ActionExecutionResult`, adicionar:

```ts
  // Presente apenas em ações de controle de fluxo (ex.: delay). Quando
  // setado, o executor NÃO segue para a próxima ação — trata o sinal.
  control?: ActionControl;
```

- [ ] **Step 4: Implementar o `DelayHandler`**

Criar `src/modules/automations/actions/handlers/delay.handler.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  ActionContext,
  ActionExecutionResult,
  ActionHandler,
} from '../action.types';

type DelayUnit = 'minutes' | 'hours' | 'days';

interface DelayParams {
  unit: DelayUnit;
  value: number;
}

const UNIT_MS: Record<DelayUnit, number> = {
  minutes: 60_000,
  hours: 3_600_000,
  days: 86_400_000,
};

// Ação de controle de fluxo: pausa o run por um tempo relativo. Não toca
// DB nem outbox — apenas calcula `resumeAt` e devolve o sinal. Toda a
// durabilidade (persistir WAITING, re-enfileirar) é do executor + watchdog.
@Injectable()
export class DelayHandler implements ActionHandler {
  readonly type = 'delay' as const;
  // Irrelevante para delay (nunca "falha" no sentido de continueOnError),
  // mas o contrato ActionHandler exige o campo.
  readonly continueOnErrorDefault = false;

  validateParams(params: Record<string, unknown>): void {
    const p = params as Partial<DelayParams>;
    if (p.unit !== 'minutes' && p.unit !== 'hours' && p.unit !== 'days') {
      throw new Error('delay: "unit" deve ser "minutes" | "hours" | "days"');
    }
    if (
      typeof p.value !== 'number' ||
      !Number.isInteger(p.value) ||
      p.value <= 0
    ) {
      throw new Error('delay: "value" deve ser inteiro > 0');
    }
  }

  async execute(
    params: Record<string, unknown>,
    _ctx: ActionContext,
  ): Promise<ActionExecutionResult> {
    const p = params as unknown as DelayParams;
    const ms = UNIT_MS[p.unit] * p.value;
    const resumeAt = new Date(Date.now() + ms).toISOString();
    return {
      ok: true,
      control: { type: 'delay', resumeAt },
      output: { unit: p.unit, value: p.value, resumeAt },
    };
  }
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `yarn test delay.handler`
Expected: PASS (todos os casos).

- [ ] **Step 6: Commit**

```bash
git add src/modules/automations/actions/action.types.ts src/modules/automations/actions/handlers/delay.handler.ts src/modules/automations/actions/handlers/delay.handler.spec.ts
git commit -m "feat(automations): ação delay + sinal de controle no ActionExecutionResult"
```

---

## Task 3: Registrar o `DelayHandler` no registry e no módulo

**Files:**
- Modify: `src/modules/automations/actions/action-registry.service.ts`
- Modify: `src/modules/automations/automations.module.ts`

- [ ] **Step 1: Injetar e registrar no `ActionRegistryService`**

Em `action-registry.service.ts`: importar e adicionar ao construtor + ao loop de `onModuleInit`.

Import (junto dos outros handlers):

```ts
import { DelayHandler } from './handlers/delay.handler';
```

No construtor, adicionar o parâmetro (última posição):

```ts
    private readonly sendMessage: SendMessageHandler,
    private readonly delay: DelayHandler,
```

No `onModuleInit`, adicionar `this.delay` ao array iterado:

```ts
    for (const handler of [
      this.addTag,
      this.removeTag,
      this.addToPipeline,
      this.movePipelineStage,
      this.assignUser,
      this.sendMessage,
      this.delay,
    ]) {
      this.handlers.set(handler.type, handler);
    }
```

- [ ] **Step 2: Declarar `DelayHandler` como provider**

Em `automations.module.ts`, importar `DelayHandler` e adicioná-lo ao array `providers` (junto dos outros handlers). Import:

```ts
import { DelayHandler } from './actions/handlers/delay.handler';
```

E na lista de `providers`, ao lado de `SendMessageHandler`, adicionar `DelayHandler,`.

- [ ] **Step 3: Verificar boot/registro com typecheck**

Run: `yarn typecheck`
Expected: PASS (dependências do registry resolvem).

- [ ] **Step 4: Commit**

```bash
git add src/modules/automations/actions/action-registry.service.ts src/modules/automations/automations.module.ts
git commit -m "feat(automations): registrar DelayHandler no registry e módulo"
```

---

## Task 4: Executor — criar run row no início, executar a partir de `startIndex`, pausar no delay

Refatora `runActions` (que hoje cria o run só no fim) em `runActionsFrom(automation, ctx, actions, startIndex, runId, priorLog)`. O run row passa a ser criado como `RUNNING` no começo e **atualizado** ao final ou na pausa.

**Files:**
- Modify: `src/modules/automations/engine/automation-executor.service.ts`
- Test: `src/modules/automations/engine/resume-context.spec.ts` (novo — testa a construção de `resumeState` de forma pura)

- [ ] **Step 1: Escrever teste puro do `resumeState`**

Criar `src/modules/automations/engine/resume-context.spec.ts`. Testa o helper estático que serializa/reconstrói o contexto de retomada (isolado de Prisma/Redis):

```ts
import { buildResumeState, parseResumeState } from './resume-context';

describe('resume-context', () => {
  it('serializa cascadeDepth e visitedAutomations', () => {
    const state = buildResumeState({
      cascadeDepth: 2,
      visitedAutomations: ['a1', 'a2'],
    });
    expect(state).toEqual({ cascadeDepth: 2, visitedAutomations: ['a1', 'a2'] });
  });

  it('reconstrói com defaults seguros quando o JSON está corrompido/nulo', () => {
    expect(parseResumeState(null)).toEqual({
      cascadeDepth: 0,
      visitedAutomations: [],
    });
    expect(parseResumeState({ foo: 'bar' })).toEqual({
      cascadeDepth: 0,
      visitedAutomations: [],
    });
  });

  it('reconstrói valores válidos', () => {
    expect(
      parseResumeState({ cascadeDepth: 3, visitedAutomations: ['x'] }),
    ).toEqual({ cascadeDepth: 3, visitedAutomations: ['x'] });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `yarn test resume-context`
Expected: FAIL — `Cannot find module './resume-context'`.

- [ ] **Step 3: Implementar `resume-context.ts`**

Criar `src/modules/automations/engine/resume-context.ts`:

```ts
// Estado mínimo persistido em AutomationRun.resumeState para que um run
// pausado por `delay` seja retomado com o MESMO contexto de cascade/loop
// que teria se rodasse sem pausa. Mantido puro (sem deps) para ser testável.

export interface ResumeState {
  cascadeDepth: number;
  visitedAutomations: string[];
}

export function buildResumeState(state: ResumeState): ResumeState {
  return {
    cascadeDepth: state.cascadeDepth,
    visitedAutomations: [...state.visitedAutomations],
  };
}

export function parseResumeState(raw: unknown): ResumeState {
  if (
    raw &&
    typeof raw === 'object' &&
    typeof (raw as ResumeState).cascadeDepth === 'number' &&
    Array.isArray((raw as ResumeState).visitedAutomations)
  ) {
    const r = raw as ResumeState;
    return {
      cascadeDepth: r.cascadeDepth,
      visitedAutomations: r.visitedAutomations.filter(
        (x): x is string => typeof x === 'string',
      ),
    };
  }
  return { cascadeDepth: 0, visitedAutomations: [] };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `yarn test resume-context`
Expected: PASS.

- [ ] **Step 5: Refatorar `runActions` → `runActionsFrom` no executor**

Em `automation-executor.service.ts`:

(a) Adicionar imports no topo:

```ts
import { buildResumeState, parseResumeState, ResumeState } from './resume-context';
```

(b) Substituir a chamada `await this.runActions(automation, job);` (dentro do `try` após adquirir o lock) por:

```ts
        // Cria o run row RUNNING e executa desde o índice 0.
        const ctx = this.buildActionContext(automation, job);
        const runId = await this.createRunningRun(automation, job, ctx);
        await this.runActionsFrom(automation, ctx, runId, 0, []);
```

(c) Adicionar o helper que monta o `ActionContext` (extraído do que `runActions` fazia inline):

```ts
  private buildActionContext(
    automation: Automation,
    job: AutomationJobData,
  ): ActionContext {
    return {
      organizationId: automation.organizationId,
      payload: job.payload,
      traceId: job.traceId,
      cascadeDepth: job.cascadeDepth + 1, // eventos emitidos vivem um hop além
      visitedAutomations: [...job.visitedAutomations, automation.id],
      outbox: this.outbox,
      prisma: this.prisma as unknown as ActionContext['prisma'],
      actorId: automation.actorId,
    };
  }
```

(d) Adicionar `createRunningRun` (cria o row antes de executar, para que uma pausa tenha o que atualizar):

```ts
  private async createRunningRun(
    automation: Automation,
    job: AutomationJobData,
    ctx: ActionContext,
  ): Promise<string> {
    const run = await this.prisma.automationRun.create({
      data: {
        automationId: automation.id,
        organizationId: automation.organizationId,
        outboxEventId: job.outboxEventId,
        traceId: job.traceId,
        status: AutomationRunStatus.RUNNING as never, // ver nota abaixo
        triggerPayload: job.payload as unknown as Prisma.InputJsonValue,
        actionsLog: [] as unknown as Prisma.InputJsonValue,
        resumeState: buildResumeState({
          cascadeDepth: ctx.cascadeDepth,
          visitedAutomations: ctx.visitedAutomations,
        }) as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return run.id;
  }
```

> **Nota:** `AutomationRunStatus` não tem `RUNNING` — usamos `WAITING` como estado "em progresso/não-terminal" NÃO é correto semanticamente. Adicionar `RUNNING` ao enum na Task 1 seria mais limpo, mas para manter Task 1 mínima usamos o seguinte: no `createRunningRun`, criar já com `status: WAITING` e `resumeAt: null`. O watchdog (Task 6) só reivindica `WAITING` **com `resumeAt <= now`**, então um run recém-criado com `resumeAt = null` nunca é reivindicado. Substituir a linha `status` acima por:

```ts
        status: AutomationRunStatus.WAITING,
        resumeAt: null,
```

- [ ] **Step 6: Implementar `runActionsFrom` (o novo loop)**

Adicionar o método `runActionsFrom`, que substitui `runActions`. Copia o loop existente mas: começa em `startIndex`, herda `priorLog`, e ao ver `result.control?.type === 'delay'` grava `WAITING` e retorna cedo. Ao terminar, **atualiza** (não cria) o run row.

```ts
  // Executa as ações de `startIndex` até o fim. Atualiza o run row `runId`.
  // Se uma ação devolver control.delay, persiste WAITING + resumeAt +
  // resumeActionIndex (o índice DA PRÓXIMA ação) e para — o watchdog retoma.
  private async runActionsFrom(
    automation: Automation,
    ctx: ActionContext,
    runId: string,
    startIndex: number,
    priorLog: ActionLogEntry[],
  ): Promise<void> {
    const startedAt = Date.now();
    const actions = this.parseActions(automation.actions);
    const log: ActionLogEntry[] = [...priorLog];
    let anyFailure = priorLog.some((e) => e.status === 'failed');
    let aborted = false;

    for (let i = startIndex; i < actions.length; i++) {
      const action = actions[i];
      const handler = this.registry.get(action.type as never);
      if (!handler) {
        log.push({
          index: i,
          type: action.type,
          status: 'failed',
          durationMs: 0,
          errorCode: 'unknown_action',
          errorMessage: `no handler for ${action.type}`,
        });
        anyFailure = true;
        if (!(action.continueOnError ?? false)) {
          aborted = true;
          break;
        }
        continue;
      }

      const startedAction = Date.now();
      try {
        const result = await handler.execute(action.params, ctx);
        const dur = Date.now() - startedAction;

        // ── Sinal de controle: delay pausa o run e retorna cedo. ──
        if (result.ok && result.control?.type === 'delay') {
          log.push({
            index: i,
            type: action.type,
            status: 'success',
            durationMs: dur,
            output: result.output,
          });
          await this.pauseRun(runId, {
            resumeAt: new Date(result.control.resumeAt),
            resumeActionIndex: i + 1, // continua DEPOIS do delay
            actionsLog: log,
          });
          return; // NÃO finaliza contadores — run continua vivo
        }

        if (result.ok) {
          log.push({
            index: i,
            type: action.type,
            status: 'success',
            durationMs: dur,
            output: result.output,
          });
        } else {
          anyFailure = true;
          log.push({
            index: i,
            type: action.type,
            status: 'failed',
            durationMs: dur,
            errorCode: result.errorCode,
            errorMessage: result.errorMessage,
            output: result.output,
          });
          const continueOnError =
            action.continueOnError ?? handler.continueOnErrorDefault;
          if (!continueOnError) {
            aborted = true;
            break;
          }
        }
      } catch (err) {
        const dur = Date.now() - startedAction;
        anyFailure = true;
        log.push({
          index: i,
          type: action.type,
          status: 'failed',
          durationMs: dur,
          errorCode: 'handler_threw',
          errorMessage: (err as Error).message,
        });
        const continueOnError =
          action.continueOnError ?? handler.continueOnErrorDefault;
        if (!continueOnError) {
          aborted = true;
          break;
        }
      }
    }

    const durationMs = Date.now() - startedAt;
    let runStatus: AutomationRunStatus;
    if (!anyFailure) runStatus = AutomationRunStatus.SUCCESS;
    else if (aborted) runStatus = AutomationRunStatus.FAILED;
    else runStatus = AutomationRunStatus.PARTIAL;

    await this.finalizeRun(runId, {
      status: runStatus,
      actionsLog: log,
      durationMs,
    });
    await this.updateAutomationCounters(automation.id, runStatus);
  }
```

- [ ] **Step 7: Implementar `pauseRun` e `finalizeRun`; manter `persistRun` para os SKIPPED pré-lock**

Adicionar dois helpers. `pauseRun` grava WAITING + resumeAt; `finalizeRun` grava o estado terminal e limpa os campos de resume. Ambos emitem o realtime como `persistRun` já faz.

```ts
  private async pauseRun(
    runId: string,
    data: {
      resumeAt: Date;
      resumeActionIndex: number;
      actionsLog: ActionLogEntry[];
    },
  ): Promise<void> {
    try {
      const run = await this.prisma.automationRun.update({
        where: { id: runId },
        data: {
          status: AutomationRunStatus.WAITING,
          resumeAt: data.resumeAt,
          resumeActionIndex: data.resumeActionIndex,
          actionsLog: data.actionsLog as unknown as Prisma.InputJsonValue,
        },
      });
      this.realtime.emitToOrg(run.organizationId, 'automation:run', {
        automationId: run.automationId,
        run,
      });
    } catch (err) {
      this.logger.error(
        `Failed to pause run ${runId}: ${(err as Error).message}`,
      );
    }
  }

  private async finalizeRun(
    runId: string,
    data: {
      status: AutomationRunStatus;
      actionsLog: ActionLogEntry[];
      durationMs: number;
      errorCode?: string;
      errorMessage?: string;
    },
  ): Promise<void> {
    try {
      const run = await this.prisma.automationRun.update({
        where: { id: runId },
        data: {
          status: data.status,
          errorCode: data.errorCode ?? null,
          errorMessage: data.errorMessage ?? null,
          actionsLog: data.actionsLog as unknown as Prisma.InputJsonValue,
          durationMs: data.durationMs,
          finishedAt: new Date(),
          // Limpa o estado de retomada — run terminou.
          resumeAt: null,
          resumeActionIndex: null,
        },
      });
      this.realtime.emitToOrg(run.organizationId, 'automation:run', {
        automationId: run.automationId,
        run,
      });
    } catch (err) {
      this.logger.error(
        `Failed to finalize run ${runId}: ${(err as Error).message}`,
      );
    }
  }
```

> `persistRun` (o método antigo) continua existindo e sendo usado pelos caminhos pré-lock (`loop_detected`, `schema_version_mismatch`, `actor_unauthorized`, `rate_limited`) — esses criam um run terminal direto e não passam por `runActionsFrom`. Não mexer neles.

- [ ] **Step 8: Remover o `runActions` antigo**

Apagar o método `private async runActions(...)` inteiro (foi substituído por `buildActionContext` + `createRunningRun` + `runActionsFrom`). Garantir que não há outra referência a ele.

Run: `yarn typecheck`
Expected: PASS. Se acusar "runActions is not used / not found", confirmar que a única chamada era a que substituímos no Step 5(b).

- [ ] **Step 9: Commit**

```bash
git add src/modules/automations/engine/
git commit -m "feat(automations): executor cria run row e pausa em ação delay (runActionsFrom)"
```

---

## Task 5: `resumeRun` no executor — retomar do índice salvo

**Files:**
- Modify: `src/modules/automations/engine/automation-executor.service.ts`
- Modify: `src/modules/automations/automations.types.ts` (novo tipo `AutomationResumeJobData`)

- [ ] **Step 1: Definir `AutomationResumeJobData`**

Em `automations.types.ts`, ao final (após `AutomationJobData`), adicionar:

```ts
// ─── Resume job (fila dedicada de retomada) ──────────────────────────
// Emitido pelo watchdog quando um run WAITING vence. Carrega só o id do
// run — todo o resto (payload, trace, índice, resumeState) vem do row.
export interface AutomationResumeJobData {
  runId: string;
  organizationId: string;
}
```

- [ ] **Step 2: Implementar `resumeRun` no executor**

Adicionar o método público `resumeRun`. Carrega o run + automation, reconstrói o `ActionContext` a partir de `triggerPayload` + `resumeState`, re-adquire o lock por contato e continua de `resumeActionIndex`.

```ts
  // Entrada de RETOMADA: chamada pelo AutomationResumeProcessor. Diferente
  // de execute(): não busca regras por trigger — retoma UM run específico.
  async resumeRun(data: AutomationResumeJobData): Promise<void> {
    const run = await this.prisma.automationRun.findUnique({
      where: { id: data.runId },
      include: { automation: true },
    });

    // Idempotência: o watchdog já flipou WAITING→? ao reivindicar. Se o run
    // sumiu, não está mais aguardando, ou não tem índice, não há o que fazer.
    if (
      !run ||
      run.resumeActionIndex === null ||
      run.status === AutomationRunStatus.SUCCESS ||
      run.status === AutomationRunStatus.FAILED ||
      run.status === AutomationRunStatus.PARTIAL
    ) {
      return;
    }

    const automation = run.automation;

    // Regra apagada/desabilitada enquanto dormia → encerra o run como FAILED
    // com motivo claro (não tenta executar ações de uma regra morta).
    if (!automation || automation.deletedAt || !automation.enabled) {
      await this.finalizeRun(run.id, {
        status: AutomationRunStatus.FAILED,
        actionsLog: this.parseLog(run.actionsLog),
        durationMs: run.durationMs ?? 0,
        errorCode: 'automation_unavailable',
        errorMessage: 'regra apagada ou desabilitada durante o delay',
      });
      return;
    }

    const resume: ResumeState = parseResumeState(run.resumeState);
    const payload = run.triggerPayload as unknown as AutomationJobData['payload'];

    const ctx: ActionContext = {
      organizationId: automation.organizationId,
      payload,
      traceId: run.traceId,
      cascadeDepth: resume.cascadeDepth,
      visitedAutomations: resume.visitedAutomations,
      outbox: this.outbox,
      prisma: this.prisma as unknown as ActionContext['prisma'],
      actorId: automation.actorId,
    };

    // Re-adquire o lock por contato — não o seguramos durante a espera.
    const lockToken = await this.redis.acquireContactLock(payload.contactId);
    if (!lockToken) {
      // Contenção: outro worker mexe nesse contato. Re-throw → BullMQ
      // retenta o job de resume com backoff. O run segue WAITING? Não —
      // o watchdog já o reivindicou. Por isso o watchdog NÃO deve zerar
      // resumeAt ao reivindicar (ver Task 6): assim, se o resume falhar,
      // um tick futuro do watchdog o reivindica de novo.
      throw new Error(`contact ${payload.contactId} locked — resume retry`);
    }

    try {
      await this.runActionsFrom(
        automation,
        ctx,
        run.id,
        run.resumeActionIndex,
        this.parseLog(run.actionsLog),
      );
    } finally {
      await this.redis.releaseContactLock(payload.contactId, lockToken);
    }
  }

  // Helper: lê actionsLog persistido de volta para o tipo tipado.
  private parseLog(raw: unknown): ActionLogEntry[] {
    return Array.isArray(raw) ? (raw as ActionLogEntry[]) : [];
  }
```

(Adicionar o import do tipo no topo, junto de `AutomationJobData`:)

```ts
import { AutomationJobData, AutomationResumeJobData } from '../automations.types';
```

- [ ] **Step 3: Typecheck**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/automations/engine/automation-executor.service.ts src/modules/automations/automations.types.ts
git commit -m "feat(automations): resumeRun retoma run WAITING do índice salvo com re-lock"
```

---

## Task 6: Watchdog de retomada — reivindicar runs vencidos e enfileirar

Mesmo padrão do `RecoveryWatchdogCron`: um job repeat registrado no boot; o scan roda no worker. Reivindica atômico com `updateMany` guardado por status+resumeAt (evita dois workers pegarem o mesmo run).

**Files:**
- Modify: `src/modules/automations/automations.constants.ts`
- Create: `src/modules/automations/workers/automation-resume-watchdog.cron.ts`
- Test: `src/modules/automations/workers/automation-resume-watchdog.cron.spec.ts`
- Modify: `src/modules/automations/automations.module.ts` (registrar filas + provider)

- [ ] **Step 1: Constantes de fila/job/cadência**

Em `automations.constants.ts`, adicionar ao final:

```ts
// ─── Retomada de runs pausados por `delay` ───────────────────────────
export const AUTOMATION_RESUME_QUEUE = 'automation-resume';
export const AUTOMATION_RESUME_WATCHDOG_QUEUE = 'automation-resume-watchdog';
export const AUTOMATION_RESUME_WATCHDOG_JOB = 'scan-due-runs';

// Cadência do scan de runs vencidos. 30s dá granularidade boa para delays
// medidos em horas/dias sem martelar o banco.
export const RESUME_WATCHDOG_PATTERN = '*/30 * * * * *';

// Quantos runs vencidos reivindicar por tick (evita enfileirar 10k de uma vez).
export const RESUME_CLAIM_BATCH_SIZE = 100;
```

- [ ] **Step 2: Escrever o teste do reivindicador**

O scan tem um método `claimAndEnqueueDueRuns(now)` testável isoladamente com Prisma/Queue mockados. Criar `automation-resume-watchdog.cron.spec.ts`:

```ts
import { AutomationResumeWatchdogCron } from './automation-resume-watchdog.cron';
import { AutomationRunStatus } from '@prisma/client';

describe('AutomationResumeWatchdogCron.claimAndEnqueueDueRuns', () => {
  const now = new Date('2026-07-09T12:00:00.000Z');

  function makeCron(dueRuns: any[]) {
    const updated = { count: dueRuns.length };
    const prisma = {
      automationRun: {
        findMany: jest.fn().mockResolvedValue(dueRuns),
      },
    };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const cron = new AutomationResumeWatchdogCron(
      prisma as any,
      queue as any,
    );
    return { cron, prisma, queue, updated };
  }

  it('enfileira um job por run vencido', async () => {
    const { cron, queue, prisma } = makeCron([
      { id: 'run1', organizationId: 'org1' },
      { id: 'run2', organizationId: 'org1' },
    ]);
    const n = await cron.claimAndEnqueueDueRuns(now);
    expect(n).toBe(2);
    expect(prisma.automationRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: AutomationRunStatus.WAITING,
          resumeAt: { lte: now },
        }),
      }),
    );
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(
      'resume',
      { runId: 'run1', organizationId: 'org1' },
      expect.objectContaining({ jobId: 'resume:run1' }),
    );
  });

  it('não enfileira nada quando não há runs vencidos', async () => {
    const { cron, queue } = makeCron([]);
    const n = await cron.claimAndEnqueueDueRuns(now);
    expect(n).toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `yarn test automation-resume-watchdog`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar o watchdog**

Criar `automation-resume-watchdog.cron.ts`:

```ts
import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job, Queue } from 'bullmq';
import { AutomationRunStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  AUTOMATION_RESUME_QUEUE,
  AUTOMATION_RESUME_WATCHDOG_QUEUE,
  AUTOMATION_RESUME_WATCHDOG_JOB,
  RESUME_WATCHDOG_PATTERN,
  RESUME_CLAIM_BATCH_SIZE,
} from '../automations.constants';

// Varre AutomationRun WAITING com resumeAt vencido e enfileira um job de
// retomada por run. Mesmo padrão do RecoveryWatchdogCron: repeat no boot,
// scan no worker.
//
// NÃO flipa o status ao enfileirar — o `jobId: resume:<runId>` da fila de
// resume garante dedup (BullMQ ignora job com id repetido enquanto ativo),
// e o resumeRun é idempotente. Assim, se um resume falhar/reiniciar, um
// tick futuro re-enfileira naturalmente.
@Processor(AUTOMATION_RESUME_WATCHDOG_QUEUE, { concurrency: 1 })
export class AutomationResumeWatchdogCron
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(AutomationResumeWatchdogCron.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(AUTOMATION_RESUME_QUEUE) private readonly resumeQueue: Queue,
    @InjectQueue(AUTOMATION_RESUME_WATCHDOG_QUEUE)
    private readonly watchdogQueue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.watchdogQueue.add(
        AUTOMATION_RESUME_WATCHDOG_JOB,
        {},
        {
          repeat: { pattern: RESUME_WATCHDOG_PATTERN },
          jobId: 'automation-resume-watchdog-cron',
          removeOnComplete: 10,
          removeOnFail: 10,
        },
      );
    } catch (err) {
      this.logger.error(
        `falha ao registrar watchdog repeat: ${(err as Error).message}`,
      );
    }
  }

  async process(_job: Job): Promise<void> {
    await this.claimAndEnqueueDueRuns(new Date());
  }

  // Testável isoladamente. Retorna quantos runs foram enfileirados.
  async claimAndEnqueueDueRuns(now: Date): Promise<number> {
    const due = await this.prisma.automationRun.findMany({
      where: {
        status: AutomationRunStatus.WAITING,
        resumeAt: { lte: now },
      },
      select: { id: true, organizationId: true },
      orderBy: { resumeAt: 'asc' },
      take: RESUME_CLAIM_BATCH_SIZE,
    });

    for (const run of due) {
      await this.resumeQueue.add(
        'resume',
        { runId: run.id, organizationId: run.organizationId },
        {
          // dedup: enquanto um resume:<runId> estiver na fila/ativo, ticks
          // repetidos não criam duplicata.
          jobId: `resume:${run.id}`,
          removeOnComplete: true,
          removeOnFail: 50,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2_000 },
        },
      );
    }

    if (due.length > 0) {
      this.logger.log(`enfileirados ${due.length} run(s) de resume`);
    }
    return due.length;
  }
}
```

> Nota sobre a constante `resumeAt = null` recém-criado (Task 4, Step 5): como o `where` exige `resumeAt: { lte: now }`, um run em progresso (`resumeAt: null`) nunca casa. Só entram runs realmente pausados por delay.

- [ ] **Step 5: Rodar e ver passar**

Run: `yarn test automation-resume-watchdog`
Expected: PASS.

- [ ] **Step 6: Registrar filas e provider no módulo**

Em `automations.module.ts`:

Importar as constantes das filas e registrar via `BullModule.registerQueue`. Localizar o `BullModule.registerQueue({ name: AUTOMATION_QUEUE })` existente e acrescentar as duas novas filas ao mesmo array de registro (ou chamadas adicionais):

```ts
import {
  AUTOMATION_RESUME_QUEUE,
  AUTOMATION_RESUME_WATCHDOG_QUEUE,
} from './automations.constants';
import { AutomationResumeWatchdogCron } from './workers/automation-resume-watchdog.cron';
```

No array de `imports`, adicionar os registros de fila (seguindo a forma já usada para `AUTOMATION_QUEUE`):

```ts
    BullModule.registerQueue(
      { name: AUTOMATION_RESUME_QUEUE },
      { name: AUTOMATION_RESUME_WATCHDOG_QUEUE },
    ),
```

E adicionar `AutomationResumeWatchdogCron` ao array `providers`.

- [ ] **Step 7: Typecheck**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/automations/automations.constants.ts src/modules/automations/workers/automation-resume-watchdog.cron.ts src/modules/automations/workers/automation-resume-watchdog.cron.spec.ts src/modules/automations/automations.module.ts
git commit -m "feat(automations): watchdog reivindica runs WAITING vencidos e enfileira resume"
```

---

## Task 7: Processor de resume — consumir a fila e chamar `resumeRun`

**Files:**
- Create: `src/modules/automations/workers/automation-resume.processor.ts`
- Modify: `src/modules/automations/automations.module.ts` (provider)

- [ ] **Step 1: Implementar o processor**

Espelha o `AutomationEventProcessor`, mas sem outbox/webhook: só respeita o kill-switch e chama `executor.resumeRun`. Criar `automation-resume.processor.ts`:

```ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AUTOMATION_RESUME_QUEUE } from '../automations.constants';
import { AutomationResumeJobData } from '../automations.types';
import { KillSwitchService } from '../kill-switch.service';
import { AutomationExecutorService } from '../engine/automation-executor.service';

@Processor(AUTOMATION_RESUME_QUEUE, { concurrency: 4 })
export class AutomationResumeProcessor extends WorkerHost {
  private readonly logger = new Logger(AutomationResumeProcessor.name);

  constructor(
    private readonly killSwitch: KillSwitchService,
    private readonly executor: AutomationExecutorService,
  ) {
    super();
  }

  async process(job: Job<AutomationResumeJobData>): Promise<void> {
    // Kill-switch OFF: não retoma agora. NÃO joga o run fora — deixa WAITING
    // com o resumeAt já vencido; quando religarem o switch, o watchdog o
    // reivindica de novo no próximo tick. Só não re-throw (evita retry loop).
    if (!this.killSwitch.isEnabled()) {
      this.logger.warn(
        `kill-switch OFF — resume adiado (run=${job.data.runId})`,
      );
      return;
    }

    // resumeRun re-throw em contenção de lock → BullMQ retenta (attempts+backoff
    // configurados no enqueue). Qualquer outro erro também sobe para retry.
    await this.executor.resumeRun(job.data);
  }
}
```

- [ ] **Step 2: Registrar como provider**

Em `automations.module.ts`, importar e adicionar `AutomationResumeProcessor` ao array `providers`:

```ts
import { AutomationResumeProcessor } from './workers/automation-resume.processor';
```

- [ ] **Step 3: Typecheck**

Run: `yarn typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/automations/workers/automation-resume.processor.ts src/modules/automations/automations.module.ts
git commit -m "feat(automations): processor consome fila de resume e chama resumeRun"
```

---

## Task 8: Teste de integração — ciclo trigger → ação → delay → resume → ação

Valida o comportamento ponta-a-ponta do executor com Prisma/Redis/registry mockados, exercitando pausa e retomada sem BullMQ real.

**Files:**
- Test: `src/modules/automations/engine/delay-resume.integration.spec.ts`

- [ ] **Step 1: Escrever o teste**

Criar `src/modules/automations/engine/delay-resume.integration.spec.ts`. Monta um executor com dependências fakes; a automação tem 3 ações: `[send_message, delay(1h), add_tag]`. Verifica: (1) primeira passada executa a ação 0, vê o delay e grava WAITING com `resumeActionIndex = 2`; (2) `resumeRun` continua da ação 2 e finaliza SUCCESS.

```ts
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
    // Prisma fake: guarda um único run row em `store.run`.
    const prisma: any = {
      automation: { findMany: jest.fn(), update: jest.fn().mockResolvedValue({ consecutiveFailures: 0 }) },
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
    // checkActor é privado e consulta DB — stub para "autorizado".
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
```

- [ ] **Step 2: Rodar e ver passar (ou ajustar assinatura do construtor)**

Run: `yarn test delay-resume.integration`
Expected: PASS. Se falhar por ordem dos parâmetros do construtor, conferir a ordem real em `AutomationExecutorService` (`prisma, evaluator, registry, outbox, redis, realtime`) e alinhar o fake.

- [ ] **Step 3: Rodar a suíte inteira do módulo**

Run: `yarn test automations`
Expected: PASS — nada quebrou nos specs existentes (outbox-dedup etc.).

- [ ] **Step 4: Commit**

```bash
git add src/modules/automations/engine/delay-resume.integration.spec.ts
git commit -m "test(automations): integração delay→WAITING→resume→SUCCESS"
```

---

## Self-Review (feito na escrita do plano)

- **Cobertura do spec:** ação `delay` (T2), estado durável (T1), pausa (T4), retomada (T5), watchdog (T6), consumo (T7), E2E (T8). ✔
- **Consistência de tipos:** `ActionExecutionResult.control` (T2) é lido em `runActionsFrom` (T4). `resumeActionIndex`/`resumeAt`/`resumeState` (T1) escritos em `pauseRun`/`createRunningRun` (T4) e lidos em `resumeRun` (T5) e no watchdog (T6). `AutomationResumeJobData` (T5) usado em T6/T7. `buildResumeState`/`parseResumeState` (T4) usados em T4/T5. ✔
- **Sem placeholders:** todo passo de código traz o código real. ✔
- **Pontos de atenção deixados explícitos:** enum `WAITING` como estado não-terminal + `resumeAt=null` para "em progresso" (T4 Step 5 nota); `ALTER TYPE ADD VALUE` no deploy prod (T1 Step 3 nota); watchdog NÃO flipa status ao enfileirar, dedup via `jobId` (T6 Step 4 nota); kill-switch adia sem descartar (T7).

## Riscos e decisões registradas (ADR-lite)

1. **`WAITING` cobre "em progresso" e "pausado".** Distinção feita por `resumeAt` (null = rodando; setado = dormindo). Evita adicionar `RUNNING` ao enum agora. Se no futuro precisarmos observar runs "presos rodando", aí sim adicionar `RUNNING`.
2. **Watchdog + `resumeAt`/cron** em vez de BullMQ delayed jobs. Motivo: delays de dias ficam em row inspecionável/cancelável no DB (sobrevive a flush do Redis), consistente com `inactivity-watchdog`/`recovery-watchdog` já existentes.
3. **Lock por contato NÃO é seguro durante a espera** — liberado ao pausar, re-adquirido no resume. Correto: segurar um mutex Redis por 3 dias é inviável.
4. **Idempotência do resume** garantida por: watchdog não muta status ao enfileirar + `jobId: resume:<runId>` (dedup BullMQ) + `resumeRun` sai cedo se o run já não está aguardando.
