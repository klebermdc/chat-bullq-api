# Cadência de Reengajamento de Entrada ("Não respondeu") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma segunda cadência (`trigger = NO_REPLY`) que reengaja leads que pararam de responder à Aline (SDR IA) **antes de chegar num humano**, com 3 toques (3h/24h/3d); ao esgotar, o card vai para uma nova etapa "Não respondeu"; qualquer resposta faz a Aline reassumir.

**Architecture:** Reusa 100% da mecânica de `modules/cadences` + `modules/scheduling` (agendamento de toques, dispatch, auto-cancel no reply, templates HSM, `onStepSent` que já move o card pro `lostStageId` ao esgotar). O único código novo é o **gatilho de inscrição** (hook no envio de mensagem da Aline) e um **ramo de inbound** que, para cadências `NO_REPLY`, só para o enrollment (Aline reassume) em vez de classificar Sim/Não.

**Tech Stack:** NestJS + Prisma 6 + Postgres + BullMQ (API) · Next.js (web). Testes: Jest (`*.spec.ts` colocados). Multitenant por `organizationId` (sem RLS — ver skill `ofp-schema`).

**Base do PR:** `feat/conversation-tabs` (branch viva do VPS). Criar branch própria — NÃO push direto na viva (ver memória `deploy-via-pr-nao-push-direto`).

---

## Contexto de código já verificado (leia antes de começar)

- `CadenceRunner.start(conversationId, cadenceId, source, orgId?)` — inscrição **idempotente** (`findActiveByConversation` → 1 enrollment ACTIVE por conversa, independente da cadência), agenda o 1º passo, respeita `enabled` e `optOutTagId`. `src/modules/cadences/cadence-runner.service.ts:98`.
- `CadenceRunner.onStepSent(...)` — ao esgotar os passos, **já** move o card para `cadence.lostStageId` e encerra com `COMPLETED_NO_REPLY`. `cadence-runner.service.ts:179`. **Reusaremos isto tal como está** — a etapa destino "Não respondeu" é só o `lostStageId` da cadência NO_REPLY.
- `CadenceRunner.maybeStartForStage(...)` — padrão do gatilho STAGE_ENTER (`cadence-runner.service.ts:276`). Vamos criar o análogo `maybeStartForNoReply`.
- `CadenceInboundService.handleInbound(conversationId, message)` — hook de inbound; hoje classifica Sim/Não/Descadastrar. `src/modules/cadences/cadence-inbound.service.ts:34`. Vamos ramificar para NO_REPLY.
- `CadenceTransitionService.apply(enrollment, outcome, cadence)` — aplica efeitos; `outcome` é um union. `src/modules/cadences/cadence-transition.service.ts:71`. Vamos adicionar `'RESUMED'`.
- **Detecção de "mensagem da Aline":** o outbound guarda `message.metadata.aiAgentId` (visto em `outbound-message.processor.ts:221`). Toques de cadência são enviados com um **usuário** remetente (sem `aiAgentId`) → não re-disparam o gatilho (resolve o risco de loop toque→toque).
- **Predicado "pré-humano":** `conversation.assignedToId == null` **e** `conversation.awaitingHumanReply == false` (campos em `schema.prisma`, model Conversation).
- **Opt-out** é detectado pelo `ResponseClassifierService` mesmo sem `options` no passo (keywords `sair/parar/descadastrar/cancelar` em `response-classifier.service.ts:29`; LLM default `SIM|NAO|DESCADASTRAR`).
- Inbound já cancela toques CADENCE pendentes em QUALQUER resposta (`inbound-message.processor.ts:362`) antes de `handleInbound`.

---

## Estrutura de arquivos

**API (chat-bullq-api):**
- Modify: `prisma/schema.prisma` — enum `CadenceTrigger` (+`NO_REPLY`), enum `CadenceEnrollmentStatus` (+`RESUMED_AI`), model `Cadence` (+`watchedStageIds String[]`)
- Create: `prisma/migrations/<ts>_cadence_no_reply/migration.sql`
- Modify: `src/modules/cadences/cadences.constants.ts` — `CADENCE_NO_REPLY_DEFAULT_STEPS`
- Modify: `src/modules/cadences/cadences.repository.ts` — `findNoReply()` + persistir `watchedStageIds`
- Modify: `src/modules/cadences/dto/upsert-cadence.dto.ts` — `watchedStageIds?: string[]`
- Modify: `src/modules/cadences/cadence-runner.service.ts` — `maybeStartForNoReply()`, source `'NO_REPLY'`, `statusForReason('client_replied')`
- Modify: `src/modules/cadences/cadence-transition.service.ts` — outcome `'RESUMED'`
- Modify: `src/modules/cadences/cadence-inbound.service.ts` — ramo NO_REPLY
- Modify: `src/modules/messaging/pipeline/outbound-message.processor.ts` — hook do gatilho
- Modify: `src/modules/messaging/messaging.module.ts` (ou o módulo do processor) — injetar `CadenceRunner` (forwardRef)
- Create: `scripts/seed-nao-respondeu-stage.ts` — etapa idempotente no pipeline "Vendas OFP"

**Web (chat-bullq-web):**
- Modify: `src/features/cadences/types.ts` — `trigger`, `watchedStageIds`
- Modify: `src/features/cadences/services/cadences.service.ts` — passar campos novos
- Modify: `src/features/cadences/components/cadence-editor.tsx` — prop `kind` ('NEGOTIATION' | 'NO_REPLY')
- Modify: `src/features/cadences/components/cadence-badge.tsx` — rótulo por tipo
- Create: `src/app/(dashboard)/settings/reengagement/page.tsx`
- Modify: `src/app/(dashboard)/settings/layout.tsx` — nova aba

---

## API

### Task 1: Schema + migração (enum NO_REPLY, RESUMED_AI, watchedStageIds)

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_cadence_no_reply/migration.sql`

- [ ] **Step 1: Editar o schema**

Em `enum CadenceTrigger` adicionar `NO_REPLY`:

```prisma
enum CadenceTrigger {
  STAGE_ENTER
  MANUAL
  BOTH
  NO_REPLY
}
```

Em `enum CadenceEnrollmentStatus` adicionar `RESUMED_AI`:

```prisma
enum CadenceEnrollmentStatus {
  ACTIVE
  HANDED_OFF
  STOPPED_OPTOUT
  MOVED_LOST
  COMPLETED_NO_REPLY
  RESUMED_AI
}
```

No `model Cadence`, adicionar o campo (logo abaixo de `stageId`):

```prisma
  watchedStageIds String[] @map("watched_stage_ids")
```

- [ ] **Step 2: Gerar a migração (sem aplicar em prod)**

Run: `npx prisma migrate dev --name cadence_no_reply --create-only`
Expected: cria `prisma/migrations/<ts>_cadence_no_reply/migration.sql` com `ALTER TYPE ... ADD VALUE` para os 2 enums e `ALTER TABLE "cadences" ADD COLUMN "watched_stage_ids" TEXT[] ...`.

> **Nota Postgres:** `ALTER TYPE ... ADD VALUE` não roda dentro de transação com outros statements em algumas versões. Se `migrate dev` gerar tudo num arquivo e falhar, separe os `ADD VALUE` num arquivo de migração próprio (ou use `ADD VALUE IF NOT EXISTS`). Confirmar que a coluna array tem default: editar o SQL para `ADD COLUMN "watched_stage_ids" TEXT[] NOT NULL DEFAULT '{}'`.

- [ ] **Step 3: Regenerar o client e compilar**

Run: `npx prisma generate && npm run build`
Expected: build verde; `CadenceTrigger.NO_REPLY` e `CadenceEnrollmentStatus.RESUMED_AI` disponíveis no client.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(cadences): schema NO_REPLY + RESUMED_AI + watchedStageIds"
```

---

### Task 2: Passos padrão da cadência NO_REPLY

**Files:**
- Modify: `src/modules/cadences/cadences.constants.ts`

- [ ] **Step 1: Adicionar a constante**

Ao fim de `cadences.constants.ts`:

```typescript
/**
 * Reengajamento de entrada: leads que pararam de responder à Aline antes de
 * chegar num humano. 3 toques rápidos (3h/24h/3d). Sem botões Sim/Não — qualquer
 * resposta faz a Aline reassumir; opt-out é detectado por keyword no classifier.
 */
export const CADENCE_NO_REPLY_DEFAULT_STEPS = [
  { order: 1, delayMinutes: 180,  text: 'Oi, {nome}! 😊 Vi que ficou por aqui. Quer que eu continue montando seu roteiro pra Orlando?', options: [] as string[] },
  { order: 2, delayMinutes: 1440, text: '{nome}, ainda dá tempo de garantir os melhores preços pra sua viagem 🏰 Posso te ajudar a fechar os detalhes?', options: [] as string[] },
  { order: 3, delayMinutes: 4320, text: '{nome}, vou encerrar seu atendimento por aqui por ora 💜 Mas é só me chamar quando quiser retomar seu orçamento pra Orlando!', options: [] as string[] },
] as const;
```

- [ ] **Step 2: Compilar**

Run: `npm run build`
Expected: verde.

- [ ] **Step 3: Commit**

```bash
git add src/modules/cadences/cadences.constants.ts
git commit -m "feat(cadences): passos padrão de reengajamento de entrada (3h/24h/3d)"
```

---

### Task 3: Repositório — `findNoReply` + persistir `watchedStageIds`

**Files:**
- Modify: `src/modules/cadences/cadences.repository.ts`
- Test: `src/modules/cadences/cadences.repository.spec.ts` (criar se não existir; se o projeto não testa o repo isoladamente, cobrir via runner na Task 6 e pular este teste)

- [ ] **Step 1: Adicionar `findNoReply` ao repositório**

Logo abaixo de `findByStage`:

```typescript
  findNoReply(orgId: string) {
    return this.prisma.cadence.findFirst({
      where: { organizationId: orgId, trigger: 'NO_REPLY', enabled: true },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
  }
```

- [ ] **Step 2: Persistir `watchedStageIds` no upsert**

Nas duas ramificações do upsert em `cadences.repository.ts` (create ~linha 43 e update ~linha 60), adicionar ao `data`:

```typescript
          watchedStageIds: dto.watchedStageIds ?? [],
```

- [ ] **Step 3: Compilar**

Run: `npm run build`
Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add src/modules/cadences/cadences.repository.ts
git commit -m "feat(cadences): findNoReply + persistir watchedStageIds"
```

---

### Task 4: DTO — `watchedStageIds`

**Files:**
- Modify: `src/modules/cadences/dto/upsert-cadence.dto.ts`

- [ ] **Step 1: Adicionar o campo em `UpsertCadenceDto`** (junto aos outros opcionais)

```typescript
  @ApiPropertyOptional({ type: [String], description: 'Etapas pré-humanas monitoradas (NO_REPLY). Vazio = qualquer etapa pré-humana.' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  watchedStageIds?: string[];
```

- [ ] **Step 2: Compilar**

Run: `npm run build`
Expected: verde (`IsArray` já é importado no arquivo).

- [ ] **Step 3: Commit**

```bash
git add src/modules/cadences/dto/upsert-cadence.dto.ts
git commit -m "feat(cadences): DTO watchedStageIds"
```

---

### Task 5: Runner — status `RESUMED_AI` + source `NO_REPLY`

**Files:**
- Modify: `src/modules/cadences/cadence-runner.service.ts`
- Test: `src/modules/cadences/cadence-runner.service.spec.ts`

- [ ] **Step 1: Escrever o teste do mapeamento de status**

Adicionar em `cadence-runner.service.spec.ts` (dentro do describe existente do runner):

```typescript
it('stop("client_replied") encerra com status RESUMED_AI', async () => {
  // enrollment ACTIVE mockado
  enrollments.findById.mockResolvedValue({ id: 'e1', organizationId: 'org1', status: 'ACTIVE', conversationId: 'c1' } as any);
  enrollments.finishIfActive.mockResolvedValue({ id: 'e1' } as any);

  await runner.stop('e1', 'client_replied');

  expect(enrollments.finishIfActive).toHaveBeenCalledWith('e1', expect.objectContaining({
    status: 'RESUMED_AI',
    endReason: 'client_replied',
  }));
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx jest cadence-runner.service.spec.ts -t "RESUMED_AI"`
Expected: FAIL (`status: 'HANDED_OFF'` no lugar de `RESUMED_AI`).

- [ ] **Step 3: Implementar**

No `statusForReason` (`cadence-runner.service.ts:407`), adicionar o case antes do default:

```typescript
      case 'client_replied':
        return 'RESUMED_AI';
```

E ampliar o tipo de source (`cadence-runner.service.ts:27`):

```typescript
export type CadenceStartSource = 'MANUAL' | 'STAGE_ENTER' | 'NO_REPLY';
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx jest cadence-runner.service.spec.ts -t "RESUMED_AI"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/cadences/cadence-runner.service.ts src/modules/cadences/cadence-runner.service.spec.ts
git commit -m "feat(cadences): status RESUMED_AI + source NO_REPLY"
```

---

### Task 6: Runner — `maybeStartForNoReply` (o gatilho novo)

**Files:**
- Modify: `src/modules/cadences/cadence-runner.service.ts`
- Test: `src/modules/cadences/cadence-runner.service.spec.ts`

- [ ] **Step 1: Escrever os testes de guarda**

```typescript
describe('maybeStartForNoReply', () => {
  const conv = { id: 'c1', organizationId: 'org1', assignedToId: null, awaitingHumanReply: false };

  it('inscreve quando pré-humano, cadência NO_REPLY enabled e card em etapa monitorada', async () => {
    prisma.conversation.findUnique.mockResolvedValue(conv as any);
    prisma.card.findFirst.mockResolvedValue({ id: 'card1', stageId: 'st-coletando' } as any);
    cadences.findNoReply.mockResolvedValue({ id: 'cad-nr', enabled: true, trigger: 'NO_REPLY', watchedStageIds: ['st-coletando'], steps: [{ order: 1, delayMinutes: 180, content: {}, options: [] }] } as any);
    const startSpy = jest.spyOn(runner, 'start').mockResolvedValue({ id: 'e1' } as any);

    await runner.maybeStartForNoReply('c1');

    expect(startSpy).toHaveBeenCalledWith('c1', 'cad-nr', 'NO_REPLY');
  });

  it('NÃO inscreve quando a conversa já foi para um humano (assignedToId setado)', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ ...conv, assignedToId: 'user1' } as any);
    cadences.findNoReply.mockResolvedValue({ id: 'cad-nr', enabled: true, trigger: 'NO_REPLY', watchedStageIds: [], steps: [{ order: 1 }] } as any);
    const startSpy = jest.spyOn(runner, 'start');

    await runner.maybeStartForNoReply('c1');

    expect(startSpy).not.toHaveBeenCalled();
  });

  it('NÃO inscreve quando está aguardando humano (awaitingHumanReply=true)', async () => {
    prisma.conversation.findUnique.mockResolvedValue({ ...conv, awaitingHumanReply: true } as any);
    cadences.findNoReply.mockResolvedValue({ id: 'cad-nr', enabled: true, trigger: 'NO_REPLY', watchedStageIds: [], steps: [{ order: 1 }] } as any);
    const startSpy = jest.spyOn(runner, 'start');

    await runner.maybeStartForNoReply('c1');

    expect(startSpy).not.toHaveBeenCalled();
  });

  it('NÃO inscreve quando o card está fora das etapas monitoradas', async () => {
    prisma.conversation.findUnique.mockResolvedValue(conv as any);
    prisma.card.findFirst.mockResolvedValue({ id: 'card1', stageId: 'st-proposta' } as any);
    cadences.findNoReply.mockResolvedValue({ id: 'cad-nr', enabled: true, trigger: 'NO_REPLY', watchedStageIds: ['st-coletando'], steps: [{ order: 1 }] } as any);
    const startSpy = jest.spyOn(runner, 'start');

    await runner.maybeStartForNoReply('c1');

    expect(startSpy).not.toHaveBeenCalled();
  });

  it('no-op quando não há cadência NO_REPLY habilitada', async () => {
    cadences.findNoReply.mockResolvedValue(null);
    const startSpy = jest.spyOn(runner, 'start');
    await runner.maybeStartForNoReply('c1');
    expect(startSpy).not.toHaveBeenCalled();
  });
});
```

(Ajuste os mocks `prisma`/`cadences`/`enrollments` ao harness já usado nos testes vizinhos do arquivo. Se `runner.start` já for testado de perto, prefira espiar como acima.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest cadence-runner.service.spec.ts -t "maybeStartForNoReply"`
Expected: FAIL (`runner.maybeStartForNoReply is not a function`).

- [ ] **Step 3: Implementar `maybeStartForNoReply`**

Adicionar logo após `maybeStartForStage` (`cadence-runner.service.ts:~292`):

```typescript
  /**
   * Gatilho de reengajamento de entrada. Chamado (fire-and-forget) quando a
   * Aline (agente IA) envia uma mensagem. Inscreve apenas se:
   *  - existe cadência NO_REPLY habilitada na org;
   *  - a conversa está PRÉ-HUMANA (sem responsável e sem aguardar humano);
   *  - o card está numa etapa monitorada (ou watchedStageIds vazio = qualquer).
   * A idempotência (1 enrollment ACTIVE/conversa) e o opt-out são garantidos
   * por `start()`.
   */
  async maybeStartForNoReply(
    conversationId: string,
  ): Promise<CadenceEnrollment | null> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) return null;

    // Pré-humano: ninguém dono da conversa e não está na fila de espera humana.
    if (conversation.assignedToId || conversation.awaitingHumanReply) return null;

    const cadence = (await this.cadences.findNoReply(
      conversation.organizationId,
    )) as CadenceLike | null;
    if (!cadence || !cadence.enabled) return null;
    if (cadence.trigger !== 'NO_REPLY') return null;

    // Escopo de etapas: se configurado, o card precisa estar numa delas.
    const watched = (cadence as { watchedStageIds?: string[] }).watchedStageIds ?? [];
    if (watched.length > 0) {
      const card = await this.prisma.card.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
      });
      if (!card || !card.stageId || !watched.includes(card.stageId)) return null;
    }

    return this.start(conversationId, cadence.id, 'NO_REPLY');
  }
```

> Se `CadenceLike` não expõe `watchedStageIds`/`trigger`, amplie a interface `CadenceLike` no topo do arquivo com `trigger?: string;` e `watchedStageIds?: string[];`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest cadence-runner.service.spec.ts -t "maybeStartForNoReply"`
Expected: PASS (5 casos).

- [ ] **Step 5: Commit**

```bash
git add src/modules/cadences/cadence-runner.service.ts src/modules/cadences/cadence-runner.service.spec.ts
git commit -m "feat(cadences): maybeStartForNoReply (gatilho de reengajamento de entrada)"
```

---

### Task 7: Transition — outcome `RESUMED`

**Files:**
- Modify: `src/modules/cadences/cadence-transition.service.ts`
- Test: `src/modules/cadences/cadence-transition.service.spec.ts`

- [ ] **Step 1: Escrever o teste**

```typescript
it('RESUMED apenas para o enrollment (sem handoff, sem tag, sem mover card)', async () => {
  runner.stop.mockResolvedValue({ id: 'e1' } as any);
  const enrollment = { id: 'e1', status: 'ACTIVE', conversationId: 'c1', contactId: 'ct1', organizationId: 'org1' } as any;

  await service.apply(enrollment, 'RESUMED', {} as any);

  expect(runner.stop).toHaveBeenCalledWith('e1', 'client_replied');
  // nenhum efeito de handoff/tag/move
  expect(notifications.create ?? jest.fn()).not.toHaveBeenCalled();
});
```

(Adapte aos spies já existentes no arquivo — `runner.stop`, `prisma`, `notifications`.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest cadence-transition.service.spec.ts -t "RESUMED"`
Expected: FAIL (type `'RESUMED'` não aceito / case ausente).

- [ ] **Step 3: Implementar**

Ampliar o union em `cadence-transition.service.ts:28`:

```typescript
export type TransitionOutcome =
  | 'SIM'
  | 'NAO'
  | 'DESCADASTRAR'
  | 'ENGAGED'
  | 'AMBIGUO'
  | 'EXHAUSTED'
  | 'RESUMED';
```

Adicionar o case no switch de `apply` (antes do `EXHAUSTED`):

```typescript
      case 'RESUMED': {
        // Reengajamento (NO_REPLY): o cliente voltou a falar. Só encerra o
        // enrollment — a Aline (autônoma) reassume naturalmente pelo inbound.
        // Sem handoff a humano, sem tag, sem mover card.
        await this.runner.stop(enrollment.id, 'client_replied');
        break;
      }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest cadence-transition.service.spec.ts -t "RESUMED"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/cadences/cadence-transition.service.ts src/modules/cadences/cadence-transition.service.spec.ts
git commit -m "feat(cadences): outcome RESUMED (cliente volta, Aline reassume)"
```

---

### Task 8: Inbound — ramo NO_REPLY

**Files:**
- Modify: `src/modules/cadences/cadence-inbound.service.ts`
- Test: `src/modules/cadences/cadence-inbound.service.spec.ts`

- [ ] **Step 1: Escrever os testes**

```typescript
it('NO_REPLY: resposta comum → RESUMED (Aline reassume), sem classificar Sim/Não', async () => {
  enrollments.findActiveByConversation.mockResolvedValue({ id: 'e1', currentStep: 1, organizationId: 'org1' } as any);
  cadences.findById.mockResolvedValue({ id: 'cad', trigger: 'NO_REPLY', steps: [{ order: 1 }] } as any);
  classifier.classify.mockResolvedValue('AMBIGUO');

  await service.handleInbound('c1', { content: { text: 'oi, ainda quero sim' } } as any);

  expect(transition.apply).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), 'RESUMED', expect.anything());
});

it('NO_REPLY: opt-out → DESCADASTRAR', async () => {
  enrollments.findActiveByConversation.mockResolvedValue({ id: 'e1', currentStep: 1, organizationId: 'org1' } as any);
  cadences.findById.mockResolvedValue({ id: 'cad', trigger: 'NO_REPLY', steps: [{ order: 1 }] } as any);
  classifier.classify.mockResolvedValue('DESCADASTRAR');

  await service.handleInbound('c1', { content: { text: 'parar' } } as any);

  expect(transition.apply).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }), 'DESCADASTRAR', expect.anything());
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest cadence-inbound.service.spec.ts -t "NO_REPLY"`
Expected: FAIL (chama com outcome de classificação, não `RESUMED`).

- [ ] **Step 3: Implementar o ramo**

Em `handleInbound`, logo após obter `cadence` e antes de montar `step`/classificar (`cadence-inbound.service.ts:~48`):

```typescript
    const cadence = await this.cadences.findById(enrollment.cadenceId);
    if (!cadence) return;

    // Reengajamento de entrada: qualquer resposta faz a Aline reassumir; só o
    // opt-out desvia. Não classifica Sim/Não nem faz handoff a humano.
    if ((cadence as { trigger?: string }).trigger === 'NO_REPLY') {
      const outcome = await this.classifier.classify(
        { ...message, organizationId: enrollment.organizationId },
        {} as ClassifierStep,
      );
      await this.transition.apply(
        enrollment,
        outcome === 'DESCADASTRAR' ? 'DESCADASTRAR' : 'RESUMED',
        cadence as TransitionCadence,
      );
      return;
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest cadence-inbound.service.spec.ts -t "NO_REPLY"`
Expected: PASS (2 casos). Rode o arquivo inteiro pra garantir que o caminho de negociação (Sim/Não) segue verde: `npx jest cadence-inbound.service.spec.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/cadences/cadence-inbound.service.ts src/modules/cadences/cadence-inbound.service.spec.ts
git commit -m "feat(cadences): inbound NO_REPLY (resposta → Aline reassume; opt-out desvia)"
```

---

### Task 9: Hook do gatilho no outbound + wiring do módulo

**Files:**
- Modify: `src/modules/messaging/pipeline/outbound-message.processor.ts`
- Modify: o módulo que declara `OutboundMessageProcessor` (provavelmente `src/modules/messaging/messaging.module.ts`)
- Test: `src/modules/messaging/pipeline/outbound-retryable.spec.ts` (ou criar `outbound-message.processor.spec.ts`)

- [ ] **Step 1: Confirmar em que módulo o processor está declarado e como cadences já é referenciado**

Run: `grep -rn "OutboundMessageProcessor\|CadenceInboundService\|forwardRef" src/modules/messaging/messaging.module.ts`
Expected: identificar o `imports`/`providers`. Como `CadenceInboundService` já é injetado no `InboundMessageProcessor` via `forwardRef(() => CadencesModule)`, o mesmo import cobre `CadenceRunner` (garanta que `CadencesModule` exporta `CadenceRunner` — checar `cadences.module.ts` `exports`).

- [ ] **Step 2: Injetar `CadenceRunner` no processor**

Em `outbound-message.processor.ts`, adicionar import e ctor param:

```typescript
import { forwardRef, Inject } from '@nestjs/common';
import { CadenceRunner } from '../../cadences/cadence-runner.service';
```

No construtor:

```typescript
    @Inject(forwardRef(() => CadenceRunner))
    private readonly cadenceRunner: CadenceRunner,
```

- [ ] **Step 3: Disparar o gatilho após envio bem-sucedido**

Logo após o bloco que marca `status: MessageStatus.SENT` (após `this.prisma.message.update({... SENT ...})`, ~linha 64-72), adicionar:

```typescript
      // Reengajamento de entrada: se ESTA mensagem foi enviada pela Aline
      // (agente IA), arma a cadência NO_REPLY caso o cliente fique em silêncio.
      // Toques de cadência NÃO têm aiAgentId → não re-disparam (sem loop).
      const aiAgentId = (updated?.metadata as any)?.aiAgentId
        ?? (await this.prisma.message.findUnique({ where: { id: messageId }, select: { metadata: true } }))
             ?.metadata as any;
      if ((updated?.metadata as any)?.aiAgentId && updated?.conversationId) {
        this.cadenceRunner
          .maybeStartForNoReply(updated.conversationId)
          .catch((err) =>
            this.logger.warn(
              `cadence_no_reply_start_failed msg=${messageId}: ${(err as Error).message}`,
            ),
          );
      }
```

> Simplifique conforme o que `updated` já traz: garanta que o `.update(...)` inclua `select`/retorno com `metadata` e `conversationId` (ou faça um `findUnique` leve). O importante: condicionar a `metadata.aiAgentId` presente + ter `conversationId`, e chamar fire-and-forget.

- [ ] **Step 4: Teste do gatilho**

Adicionar teste (no spec do processor) com um `CadenceRunner` mockado:

```typescript
it('mensagem da Aline (metadata.aiAgentId) arma a cadência NO_REPLY', async () => {
  // arrange: adapter.sendMessage ok; message.update devolve metadata com aiAgentId
  prisma.message.update.mockResolvedValue({ id: 'm1', conversationId: 'c1', metadata: { aiAgentId: 'ag1' } } as any);

  await processor.process({ data: { messageId: 'm1', channelId: 'ch1', contactExternalId: 'x', message: {} } } as any);

  expect(cadenceRunner.maybeStartForNoReply).toHaveBeenCalledWith('c1');
});

it('mensagem sem aiAgentId (humano/toque) NÃO arma a cadência', async () => {
  prisma.message.update.mockResolvedValue({ id: 'm1', conversationId: 'c1', metadata: {} } as any);
  await processor.process({ data: { messageId: 'm1', channelId: 'ch1', contactExternalId: 'x', message: {} } } as any);
  expect(cadenceRunner.maybeStartForNoReply).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Rodar testes + build**

Run: `npx jest outbound && npm run build`
Expected: PASS + build verde. Se surgir dependência circular em runtime, garanta `forwardRef` nos dois lados e `exports: [CadenceRunner]` em `cadences.module.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/messaging/pipeline/outbound-message.processor.ts src/modules/messaging/messaging.module.ts src/modules/messaging/pipeline/*.spec.ts
git commit -m "feat(cadences): armar reengajamento de entrada quando a Aline envia mensagem"
```

---

### Task 10: Script idempotente da etapa "Não respondeu"

**Files:**
- Create: `scripts/seed-nao-respondeu-stage.ts`

- [ ] **Step 1: Escrever o script**

Modelar em outros `scripts/*.ts` do repo (login via API OU Prisma direto). Versão Prisma direta (roda no Mac com `DATABASE_URL` do VPS OU local):

```typescript
import { PrismaClient } from '@prisma/client';

// Uso: DATABASE_URL=... ORG_ID=<org> npx ts-node scripts/seed-nao-respondeu-stage.ts
const prisma = new PrismaClient();

async function main() {
  const orgId = process.env.ORG_ID;
  if (!orgId) throw new Error('ORG_ID obrigatório');

  const pipeline = await prisma.pipeline.findFirst({
    where: { organizationId: orgId, name: { contains: 'Vendas OFP', mode: 'insensitive' } },
    include: { stages: { orderBy: { order: 'asc' } } },
  });
  if (!pipeline) throw new Error('pipeline "Vendas OFP" não encontrado');

  const exists = pipeline.stages.find((s) => /não respondeu|nao respondeu/i.test(s.name));
  if (exists) { console.log('já existe:', exists.id); return; }

  const maxOrder = pipeline.stages.reduce((m, s) => Math.max(m, s.order), 0);
  const stage = await prisma.stage.create({
    data: { pipelineId: pipeline.id, name: 'Não respondeu', order: maxOrder + 1 },
  });
  console.log('criada etapa "Não respondeu":', stage.id, 'order', stage.order);
}

main().finally(() => prisma.$disconnect());
```

> Confirme os nomes reais dos models/campos (`prisma.pipeline`, `prisma.stage`, `stage.order`, `stage.name`) em `schema.prisma` antes de rodar — ajuste se divergir. Rodar SOMENTE no Mac (`%`), nunca no VPS (ver memória `sdr-captacao-voice-feature`).

- [ ] **Step 2: Type-check do script**

Run: `npx tsc --noEmit scripts/seed-nao-respondeu-stage.ts` (ou `npm run build` se scripts entram no tsconfig)
Expected: sem erros de tipo.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-nao-respondeu-stage.ts
git commit -m "chore(cadences): script idempotente da etapa 'Não respondeu'"
```

---

### Task 11: Suíte completa da API verde

- [ ] **Step 1: Rodar todos os testes de cadences + messaging**

Run: `npx jest src/modules/cadences src/modules/messaging`
Expected: todos PASS (incl. os testes de negociação que não podem regredir).

- [ ] **Step 2: Build final**

Run: `npm run build`
Expected: verde.

---

## Web

### Task 12: Tipos + service — `trigger` e `watchedStageIds`

**Files:**
- Modify: `src/features/cadences/types.ts`
- Modify: `src/features/cadences/services/cadences.service.ts`

- [ ] **Step 1: Ampliar os tipos**

Em `types.ts`, no tipo da Cadence/DTO adicionar:

```typescript
  trigger?: 'STAGE_ENTER' | 'MANUAL' | 'BOTH' | 'NO_REPLY';
  watchedStageIds?: string[];
```

- [ ] **Step 2: Passar os campos no service**

No `cadences.service.ts`, garantir que `upsert`/`save` inclua `trigger` e `watchedStageIds` no corpo enviado ao `POST/PUT /cadences`.

- [ ] **Step 3: Build/lint**

Run: `npm run build` (web)
Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add src/features/cadences/types.ts src/features/cadences/services/cadences.service.ts
git commit -m "feat(web/cadences): tipos trigger + watchedStageIds"
```

---

### Task 13: Editor com prop `kind`

**Files:**
- Modify: `src/features/cadences/components/cadence-editor.tsx`

- [ ] **Step 1: Adicionar a prop e ramificar**

Adicionar `kind?: 'NEGOTIATION' | 'NO_REPLY'` (default `'NEGOTIATION'`). Quando `kind === 'NO_REPLY'`:
- `trigger` salvo = `'NO_REPLY'`.
- Esconder campos específicos de negociação (etapa gatilho `stageId`, mensagens `onYes/onNo`, opções Sim/Não por passo).
- Mostrar um multi-select **"Etapas monitoradas"** (as etapas pré-humanas do pipeline escolhido) ligado a `watchedStageIds`.
- Rótulo do campo de etapa perdida vira **"Etapa ao esgotar (Não respondeu)"** (`lostStageId`).
- Pré-preencher os 3 textos padrão (3h/24h/3d) quando criando do zero.
- Manter o toggle/seleção de **template HSM por passo** (já existe no editor de negociação — reusar).

Siga a estrutura de estado/handlers já existente no arquivo (o editor de negociação é a referência byte-a-byte; só condicione a renderização por `kind`).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: verde.

- [ ] **Step 3: Commit**

```bash
git add src/features/cadences/components/cadence-editor.tsx
git commit -m "feat(web/cadences): editor com kind NO_REPLY (etapas monitoradas, sem Sim/Não)"
```

---

### Task 14: Aba + página "Reengajamento de Entrada"

**Files:**
- Create: `src/app/(dashboard)/settings/reengagement/page.tsx`
- Modify: `src/app/(dashboard)/settings/layout.tsx`

- [ ] **Step 1: Nova página**

```tsx
import { CadenceEditor } from '@/features/cadences/components/cadence-editor';

export default function ReengagementPage() {
  return <CadenceEditor kind="NO_REPLY" />;
}
```

> Se o `CadenceEditor` hoje carrega/salva "a cadência" da org sem distinguir tipo, ajuste o hook `use-cadences` para filtrar/salvar por `trigger` (a de negociação usa STAGE_ENTER/BOTH; a de reengajamento usa NO_REPLY) — assim as duas coexistem sem sobrescrever uma à outra. Este é um ponto de atenção: garanta que salvar a NO_REPLY não apague a de negociação (ids distintos; `findNoReply` vs `findByStage` no backend já separam).

- [ ] **Step 2: Registrar a aba**

Em `settings/layout.tsx`, junto ao item de Cadências:

```tsx
  { href: '/settings/reengagement', label: 'Reengajamento de Entrada', icon: Repeat },
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(dashboard)/settings/reengagement/page.tsx" "src/app/(dashboard)/settings/layout.tsx"
git commit -m "feat(web/cadences): página e aba Reengajamento de Entrada"
```

---

### Task 15: Badge por tipo no header

**Files:**
- Modify: `src/features/cadences/components/cadence-badge.tsx`

- [ ] **Step 1: Rotular por tipo**

Se o payload do enrollment/cadência expõe o `trigger`, mostrar **"🔁 Em reengajamento"** quando `NO_REPLY` e manter **"🔁 Em cadência"** caso contrário. Se o `trigger` não vier hoje, incluí-lo no include do endpoint que alimenta `use-cadences` (backend: adicionar `trigger` ao select do enrollment ativo em `cadences.controller.ts:50`).

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: verde.

- [ ] **Step 3: Commit**

```bash
git add src/features/cadences/components/cadence-badge.tsx
git commit -m "feat(web/cadences): badge 'Em reengajamento' para NO_REPLY"
```

---

## Verificação end-to-end (após deploy em staging/VPS)

1. Rodar `scripts/seed-nao-respondeu-stage.ts` (Mac) → etapa "Não respondeu" no fim do "Vendas OFP".
2. Settings → **Reengajamento de Entrada** → escolher pipeline "Vendas OFP", etapas monitoradas (Distribuir + Coletando Informação), etapa ao esgotar = "Não respondeu", tag opt-out, textos padrão, **Ativa** → salvar.
3. Mandar mensagem de cliente novo → Aline responde → **não** responder de volta.
4. Confirmar (curto os delays em staging via edição dos passos para minutos) que o toque 1 sai, depois 2, depois 3; e que após o 3º sem resposta o card vai para **"Não respondeu"**.
5. Em outra conversa, deixar a Aline mandar 1 msg, esperar armar, e **responder** → confirmar que os toques futuros somem e a Aline reassume (badge "Em reengajamento" desaparece).
6. Responder "parar" → confirmar opt-out (tag aplicada, nada mais enviado).

## Deploy (ver memórias `vps-deploy-live-stack`, `cadencia-negociacao-feature`)

- Branch própria a partir de `feat/conversation-tabs`; PRs API + Web contra `feat/conversation-tabs`.
- Ordem no VPS: `git fetch/checkout/reset` de api+web PRIMEIRO → confirmar migração presente (`ls prisma/migrations | grep cadence_no_reply`) → `docker compose up -d --build` → `migrate deploy` (deve dizer "Applying migration ..._cadence_no_reply").
- Cadência vem **desligada**; ativar só após E2E.

---

## Self-review (feito)

- **Cobertura da spec:** gatilho (Task 6+9) · pré-humano (Task 6) · 3 toques 3h/24h/3d (Task 2) · texto editável + HSM por passo (Tasks 2, 13 — reusa `templateId` do DTO/step já existente) · cliente responde → Aline reassume (Tasks 7, 8) · opt-out (Task 8) · esgotou → "Não respondeu" (reusa `onStepSent`+`lostStageId`, Task 1 cria a etapa via Task 10) · nova etapa no pipeline (Task 10) · página nova (Tasks 13-14) · badge (Task 15) · isolamento por org (findNoReply filtra `organizationId`). Todos cobertos.
- **Riscos da spec resolvidos:** (1) predicado pré-humano = `assignedToId==null && awaitingHumanReply==false` (Task 6); (2) "msg da Aline" = `metadata.aiAgentId`, toques não têm → sem loop (Task 9); (3) `lostStageId` reusado como "etapa ao esgotar", documentado; (4) `watchedStageIds` = array escalar Postgres (Task 1).
- **Consistência de tipos:** `maybeStartForNoReply(conversationId)` (Task 6/9) · outcome `'RESUMED'` (Task 7/8) · reason `'client_replied'` → `RESUMED_AI` (Task 5/7) · `watchedStageIds` (Tasks 1/3/4/6/12/13). Batem.
- **Placeholders:** os pontos "confirme o nome do model/campo" (Tasks 9,10,13,14) são verificações locais concretas, não trabalho adiado — mantidos porque dependem de detalhes do web/prisma não lidos em profundidade; cada um traz o comando/arquivo exato para resolver.
