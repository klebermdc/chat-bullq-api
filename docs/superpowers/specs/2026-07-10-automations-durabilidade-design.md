# Design: Endurecer durabilidade do motor `automations` (follow-ups do review do PR #35)

**Data:** 2026-07-10
**Branch:** `feat/automations-delay-durable` (mesma worktree do PR #35 — este trabalho é incremental sobre ele)
**Contexto:** o review final do PR #35 (delay durável) confirmou o núcleo correto, mas apontou dois gaps de durabilidade que só aparecem sob crash/outage. Esta fatia os fecha antes de confiar no motor como "durável" em produção e antes de migrar features reais (Cadência) para cima dele.

---

## Problema

O motor `automations` é **at-least-once por contrato** — no caminho normal (sem delay), um crash já faz o BullMQ refazer o job e reexecutar as ações. A feature de delay (PR #35) introduziu um estado durável (`AutomationRun` com `WAITING`/`resumeAt`/`resumeActionIndex`) e dois gaps novos:

1. **Órfã `WAITING` em crash.** `createRunningRun` grava o run como `WAITING` + `resumeAt=null` ("em progresso"). Se o processo morre antes da 1ª pausa/finalização, o row fica órfão: o watchdog só reivindica `resumeAt <= now`, então `resumeAt=null` nunca é tocado → o run fica `WAITING` para sempre, poluindo o painel de Atividade.

2. **Duplicação de `send_message` no resume.** No caminho de resume, se o processo crasha depois de um `send_message` bem-sucedido mas antes do `finalizeRun`, o watchdog re-reivindica (via `resumeAt` ainda vencido) e o **segmento inteiro pós-resume re-roda** → mensagem WhatsApp duplicada.

---

## Solução (2 fixes, aditivos, sobre a branch do #35)

### Fix 1 — Varredura de órfãs `WAITING`

Estender o `AutomationResumeWatchdogCron` para, **no mesmo tick** do scan de resume, rodar um segundo scan que reconcilia órfãs.

- Novo método testável `sweepStaleRuns(now: Date): Promise<number>`.
- Query (via `updateMany`, atômico): marca como terminal todo run com
  `status = WAITING AND resumeAt IS NULL AND startedAt < now - STALE_RUN_THRESHOLD_MS`,
  setando `status = FAILED`, `errorCode = 'stale_in_progress'`,
  `errorMessage = 'run em progresso abandonado (crash antes de pausar/finalizar)'`,
  `finishedAt = now`. Preserva o `actionsLog` parcial (não é tocado).
- `process()` do watchdog passa a chamar **os dois** scans: `claimAndEnqueueDueRuns(now)` e `sweepStaleRuns(now)`.
- Nova constante `STALE_RUN_THRESHOLD_MS = 10 * 60 * 1000` (10 min) em `automations.constants.ts`.

**Por que `FAILED` e não "tentar resume":**
- Segurança: depois de 10min *assumimos* que o processo morreu; resumir um run que por acaso ainda esteja vivo duplicaria efeitos.
- A órfã "pura" (crash antes de qualquer ação) tem `resumeActionIndex = null`, e `resumeRun` já faz no-op nela — "tentar resume" nem funcionaria.
- `FAILED` é o estado honesto: o automation crashou. Se o trabalho era necessário, o at-least-once do evento gatilho pode reprocessar.

**Threshold:** 10min é folga enorme sobre qualquer cadeia síncrona real (mesmo com HTTP externo lento) e curto o bastante para não deixar lixo visível por muito tempo. Constante nomeada, fácil de ajustar.

**Contadores/realtime:** o `updateMany` em massa NÃO atualiza os contadores por-automation (`failureCount` etc.) nem emite `automation:run` por row. Aceito e documentado: são casos raros de crash; o painel reflete no próximo refresh. Manter simples > consistência perfeita de telemetria aqui.

### Fix 2 — Checkpoint após ações de efeito externo

Encolher a janela de duplicação do resume, gravando o progresso após ações que têm **efeito colateral externo irreversível** (hoje só `send_message`; amanhã `http_request`).

- Adicionar campo **opcional** `readonly checkpoint?: boolean` à interface `ActionHandler`. Handlers existentes não o declaram → `undefined` (falsy) → sem mudança de comportamento. **Só o `SendMessageHandler`** passa a declarar `readonly checkpoint = true`.
- No `runActionsFrom`, após uma ação **não-control** bem-sucedida cujo `handler.checkpoint === true`, gravar um checkpoint: `resumeActionIndex = i + 1` + `actionsLog = log` (parcial), **sem tocar em `resumeAt`** (o run continua `WAITING`/em-progresso ou, no resume, mantém o `resumeAt` vencido que o torna re-reivindicável para continuar).
- Novo helper privado `checkpointRun(runId, { resumeActionIndex, actionsLog })` — igual ao `pauseRun` mas sem `resumeAt`. Falha de escrita é engolida+logada (best-effort): a ação já teve efeito; um blip no checkpoint não deve abortar o run (só reduz a proteção daquela ação).

**Efeito:** um crash no resume retoma da **próxima** ação, não re-executando o `send_message` já enviado. A janela de dup encolhe de "segmento inteiro" para "entre o envio e o UPDATE do checkpoint" — irredutível sem transação distribuída, e explicitamente documentada.

**Por que flag em vez de checkpoint cego:** `add_tag`/`move_pipeline_stage` já são idempotentes (`@@unique` / no-op se repetidas); checkpointar depois delas paga escrita à toa. O flag é auto-documentado (marca o que tem efeito externo) e deixa o futuro `http_request` já nascer com `checkpoint: true` sem tocar no executor.

---

## Interação entre os fixes (coerência do modelo de estado)

- Um run normal (sem delay) com `send_message` agora grava um checkpoint no meio (`resumeActionIndex` avança, `resumeAt` continua `null`). Se completa, `finalizeRun` limpa `resumeAt`/`resumeActionIndex`. Se crasha, vira órfã `WAITING`+`resumeAt=null` → varrida para `FAILED` após 10min (Fix 1). Consistente.
- Durante um resume ativo, `resumeAt` permanece no passado; o que impede re-reivindicação concorrente é o dedup por `jobId: resume:<runId>` + o lock por contato (design já existente e revisado do #35). O checkpoint não altera isso.

---

## Testes (TDD)

**Fix 1 — `sweepStaleRuns` (unit, prisma mockado):**
- Chama `updateMany` com o `where` correto (`status=WAITING`, `resumeAt: null`, `startedAt: { lt: now - STALE_RUN_THRESHOLD_MS }`) e o `data` de FAILED; retorna o `count`.
- Não afeta runs com `resumeAt` setado nem órfãs recentes (o `where` cobre via mock assertion do argumento).

**Fix 2 — checkpoint:**
- Unit: `SendMessageHandler.checkpoint === true`; `DelayHandler`/`AddTagHandler`/`MovePipelineStageHandler` não declaram (`checkpoint` undefined/falsy).
- Integração (o teste-chave, no padrão do `delay-resume.integration.spec.ts`): seed de um run `WAITING` com `resumeActionIndex = 1` (como se tivesse crashado após um `send_message` no índice 0), automação `[send_message(checkpoint), add_tag]`; `resumeRun` → **só `add_tag` executa** (`send_message` NÃO é chamado de novo). Prova a não-reexecução.
- Integração: run fresco `[send_message(checkpoint), add_tag]` sem delay → confirma que um `automationRun.update` com `resumeActionIndex: 1` (e `resumeAt` intocado) ocorre logo após o `send_message`, antes do `finalizeRun`.

---

## Fora de escopo (YAGNI)

- Transação distribuída / exactly-once real (impossível sem 2PC com o WhatsApp externo).
- Tabela/coluna de idempotency-key dedicada.
- Dedup dos demais handlers (já idempotentes).
- Atualização de contadores por-automation na varredura em massa.
- Status `RUNNING` dedicado (o par `WAITING`+`resumeAt=null` já modela "em progresso").

---

## Arquivos afetados

- `src/modules/automations/automations.constants.ts` — `STALE_RUN_THRESHOLD_MS`.
- `src/modules/automations/workers/automation-resume-watchdog.cron.ts` — `sweepStaleRuns` + chamada no `process()`.
- `src/modules/automations/workers/automation-resume-watchdog.cron.spec.ts` — teste do sweep.
- `src/modules/automations/actions/action.types.ts` — campo `checkpoint?` na interface `ActionHandler`.
- `src/modules/automations/actions/handlers/send-message.handler.ts` — `readonly checkpoint = true`.
- `src/modules/automations/engine/automation-executor.service.ts` — `checkpointRun` + chamada no `runActionsFrom` após ação checkpoint-flagged bem-sucedida.
- `src/modules/automations/engine/*.spec.ts` — testes de checkpoint (unit do handler + integração de não-reexecução).

## Plano de rollback

Ambos os fixes são aditivos e sem migração de schema (reusam os campos já criados no #35). Reverter = remover os métodos/flag; nenhum dado novo persiste além do que o #35 já persiste.
