# Reengajamento apenas para leads "parados na IA" (fase Aline)

**Data:** 2026-07-24
**Branch base:** `fork/feat/conversation-tabs` (live) — worktree `feat/reengage-only-ai-parked`
**Autor:** Kleber + Claude

## Problema

O reengajamento deve mirar **só quem ficou parado na fase da Aline (IA)** — lead que
travou ainda sob a IA, sem nenhum humano ter assumido. Hoje existem dois motores de
reengajamento e nenhum garante esse recorte:

- **Motor A — Inatividade / auto-reengage** (`origin: AUTO_REENGAGE`,
  `modules/scheduling/inactivity`): o `scanCandidates` pega **toda** conversa aberta
  com outbound enviado, sem distinguir se está com a IA ou com humano. LIVE e em uso.
- **Motor B — Cadência "Reengajamento" (NO_REPLY)** (`origin: CADENCE`,
  `modules/cadences`): já inscreve só pré-humano (`!assignedToId && !awaitingHumanReply`)
  no `maybeStartForNoReply`, mas **não** checa se a IA está ativa nem revalida no envio.
  Dormant em produção (cadência desligada).

## Objetivo

Escopar os dois motores para reengajar somente leads **parados na IA**, com **controle
no menu** (default OFF) — nada muda em produção até o Kleber ligar.

## Definição: "parado na IA" (`isAiParked`)

Uma conversa está parada na IA quando:

- `assignedToId == null` — nenhum vendedor humano assumiu, **e**
- `awaitingHumanReply == false` — não está na fila esperando humano, **e**
- `aiEnabled != false` — a IA não foi desligada manualmente na conversa
  (tri-state: `null` = segue org, `true` = forçada ON; só `false` exclui).

```ts
export function isAiParked(c: {
  assignedToId: string | null;
  awaitingHumanReply: boolean;
  aiEnabled: boolean | null;
}): boolean {
  return !c.assignedToId && !c.awaitingHumanReply && c.aiEnabled !== false;
}
```

Util compartilhada (importável por `scheduling` e `cadences`), local proposto:
`src/common/conversation/ai-parked.util.ts` (confirmar dir na fase de plano; se não
houver `common/`, colocar em `src/modules/scheduling/ai-parked.util.ts`).

## Decisões (fechadas com o usuário)

1. **Controle no menu:** toggle **por motor**, default **DESLIGADO**. Comportamento
   atual intacto até ligar.
2. **Corte mid-flight:** se um humano assume **depois** do agendamento, o disparo
   pendente é **cancelado/pulado** (revalida antes de enviar). Vale pros dois motores.
3. **Definição:** "parado na IA" = sem humano **E** IA ativa (`isAiParked` acima).
4. **Motor B sem toggle próprio:** como é inerentemente pré-humano e está desligado em
   produção, ele aplica `aiEnabled != false` no enrollment + corte no envio **direto**,
   sem chave separada. O toggle no menu fica só no **Motor A (Inatividade)**.

## Arquitetura

Ponto-chave: **os dois motores despacham pelo mesmo `scheduled-dispatch.processor.ts`**,
que já revalida antes de enviar (backstop `client_replied`). O corte mid-flight entra
nesse único ponto, dirigido por um flag gravado no próprio agendamento.

### Schema (migração aditiva)

- `InactivitySettings.reengageOnlyAiParked Boolean @default(false) @map("reengage_only_ai_parked")`
  — toggle do Motor A.
- `ScheduledMessage.requireAiParked Boolean @default(false) @map("require_ai_parked")`
  — flag por-agendamento (espelha o padrão de `cancelOnReply`). Diz ao processor que
  aquele disparo só pode sair se a conversa ainda estiver `isAiParked`.
- **Sem** campo novo em `Cadence` (Motor B não tem toggle).

Migração aditiva pura (default false) → segura para `migrate deploy` no boot.

### Motor A — Inatividade (`AUTO_REENGAGE`)

- `InactivitySettingsService` / `ResolvedInactivitySettings`: incluir `reengageOnlyAiParked`.
- DTO `update-inactivity-settings.dto.ts`: `reengageOnlyAiParked?: boolean`.
- `InactivityRepository.scanCandidates`: adicionar `aiEnabled` ao `select`
  (`assignedToId` já está).
- `InactivityWatchdogCron.process`: quando `cfg.reengageOnlyAiParked && !isAiParked(c)`,
  **pular** o `maybeCreate` (não cria o AUTO_REENGAGE). A reclassificação de faixa
  (`inactivity:updated`) continua normal.
- `AutoReengageService.maybeCreate`: gravar `requireAiParked: cfg.reengageOnlyAiParked`
  no `ScheduledMessage` criado.
- Processor (bloco de auto-retry): propagar `requireAiParked: row.requireAiParked` na
  linha de retry (`origin AUTO_REENGAGE`).

### Motor B — Cadência NO_REPLY (`CADENCE`)

- `CadenceRunner.maybeStartForNoReply`: no gate pré-humano (hoje
  `if (conversation.assignedToId || conversation.awaitingHumanReply) return null`),
  incluir também `conversation.aiEnabled === false` → não inscreve se a IA foi desligada.
  (Sempre — sem toggle.)
- `CadenceRunner.scheduleStep`: gravar `requireAiParked: true` no `ScheduledMessage`
  do passo (`origin CADENCE`).

### Corte no envio (ponto único — `ScheduledDispatchProcessor.process`)

Logo após o backstop de `client_replied` (hoje ~linha 65), antes de `claimForDispatch`:

- Ampliar o `select` da conversa com `assignedToId, awaitingHumanReply, aiEnabled`.
- Guarda:
  ```ts
  if (row.requireAiParked && !isAiParked(conversation)) {
    await this.repo.update(row.id, {
      status: 'CANCELED',
      canceledAt: new Date(),
      cancelReason: 'not_ai_parked',
    });
    return; // não envia; no AUTO_REENGAGE, também não reagenda (return antes do retry)
  }
  ```

Como o `return` acontece antes do bloco de envio/retry, um AUTO_REENGAGE cancelado aqui
não gera a próxima tentativa — o burst para quando o humano assume. Para CADENCE, o
`onStepSent` também não roda (não houve envio), então a cadência não avança.

### Web (só Motor A)

- `features/scheduling/components/inactivity-settings-form.tsx`: nova chave
  "Reengajar apenas leads parados na IA (sem humano)".
- `features/scheduling/types.ts` + `scheduling.service.ts`: incluir `reengageOnlyAiParked`
  no tipo de settings e no PUT.

## Fluxo de dados

1. Watchdog varre (Motor A) / Aline envia msg (Motor B) → decide inscrever conforme o
   recorte AI-parked → cria `ScheduledMessage` com `requireAiParked` apropriado.
2. Job dispara no horário → `ScheduledDispatchProcessor`:
   fechada/arquivada? cliente respondeu? **não é mais AI-parked (se `requireAiParked`)?**
   → cancela/pula. Senão envia.
3. Humano assume no meio → próximo disparo é cortado no envio; AUTO_REENGAGE não reagenda.

## Casos de erro / borda

- **Toggle A OFF (default):** `requireAiParked=false` nos AUTO_REENGAGE → guarda não
  dispara → comportamento atual idêntico.
- **`aiEnabled=null`** (segue org): conta como IA ativa → reengaja. Só `false` exclui.
- **Lead sem card (Motor B):** inalterado; `watchedStageIds` continua como está.
- **Corrida assume-vs-envio:** o processor lê o estado atual da conversa no momento do
  disparo; se o humano assumiu antes do job rodar, corta. `claimForDispatch` mantém a
  idempotência.

## Testes

- Unit `isAiParked`: sem humano+IA ativa=true; assignedTo/awaitingHuman/aiEnabled=false → false; aiEnabled=null → true.
- `maybeStartForNoReply`: não inscreve quando `aiEnabled===false`; inscreve quando null/true.
- Watchdog: com toggle ON pula não-parado e mantém parado; com OFF cria pra todos (atual).
- `maybeCreate`: grava `requireAiParked` = valor do cfg.
- Processor: com `requireAiParked` e conversa não-parada → CANCELED `not_ai_parked`
  (origens AUTO_REENGAGE e CADENCE); com parada → envia; AUTO_REENGAGE cancelado não reagenda.

## Fora de escopo (YAGNI)

- Toggle para o Motor B.
- Mudar a definição de faixas/quiet hours/tentativas.
- Backfill de agendamentos já criados (o corte no envio já cobre os pendentes).

## Deploy

- Branch própria a partir da live + **PR** (sem push direto na `feat/conversation-tabs`).
- Migração aditiva aplicada no boot da API ao recriar container (padrão do projeto).
- Ativar via menu: `Settings → Inatividade` → ligar "Reengajar apenas leads parados na IA".
