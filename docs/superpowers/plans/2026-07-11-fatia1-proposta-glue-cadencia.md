# Fatia 1 — Proposta glue: "Proposta enviada" + cadência — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao enviar a proposta pelo ✈️, mover automaticamente o card da conversa para a etapa "Proposta enviada", disparando a cadência existente.

**Architecture:** Novo método `PipelinesService.enterStageForConversation()` encapsula resolver-pipeline/etapa → find-or-create card → mover (que já dispara `maybeStartForStage`). `ProposalsService` chama esse método depois do envio bem-sucedido, num `try/catch` isolado (falha de automação nunca derruba o envio). Sem migração de banco.

**Tech Stack:** NestJS, Prisma, Jest. Repo `chat-bullq-api`, branch `feat/proposta-glue-cadencia` (base `fork/feat/conversation-tabs`).

---

## Contexto de código (verificado)

- `PipelinesService` construtor posicional: `(prisma, realtime, cadenceRunner)` — `src/modules/pipelines/pipelines.service.ts:35-40`.
- `moveCard(cardId, org, { toStageId, toIndex })` dispara `cadenceRunner.maybeStartForStage(conversationId, cardId, toStageId, org)` quando muda de etapa e o card tem `conversationId` — `pipelines.service.ts:491-504`.
- `createCard(pipelineId, org, dto: CreateCardDto)` faz upsert por conversa (hidrata título/contato), aceita `stageId`, mas **não** dispara cadência — `pipelines.service.ts:232-330`.
- `maybeStartForStage(conversationId, cardId|null, stageId, orgId)` — `src/modules/cadences/cadence-runner.service.ts:276`.
- `ProposalsService` construtor posicional: `(prisma, render, extraction, repo, messages)` — `src/modules/proposals/proposals.service.ts:22-28`. Envia a proposta em `create()` linha 88.
- `Pipeline.name` e `PipelineStage.name` são strings editáveis — `prisma/schema.prisma:1457,1483`.
- `PipelinesModule` exporta `PipelinesService` — `src/modules/pipelines/pipelines.module.ts`.

## File Structure

- **Modify** `src/modules/proposals/proposals.constants.ts` — add nomes de pipeline/etapa configuráveis.
- **Modify** `src/modules/pipelines/pipelines.service.ts` — add método `enterStageForConversation`.
- **Create** `src/modules/pipelines/pipelines.enter-stage.spec.ts` — unit do novo método.
- **Modify** `src/modules/proposals/proposals.service.ts` — injeta `PipelinesService`, chama após envio.
- **Modify** `src/modules/proposals/proposals.module.ts` — importa `PipelinesModule`.
- **Modify** `src/modules/proposals/proposals.service.spec.ts` — 6º dep no construtor + 2 testes novos.

---

## Task 1: Constantes de pipeline/etapa

**Files:**
- Modify: `src/modules/proposals/proposals.constants.ts`

- [ ] **Step 1: Adicionar as constantes**

Anexar ao final de `src/modules/proposals/proposals.constants.ts`:

```ts
/**
 * Onde o card cai quando a proposta é enviada. Nome é editável pelo operador
 * na UI, então deixamos configurável por env com defaults sensatos.
 */
export const PROPOSAL_SENT_PIPELINE_NAME =
  process.env.SALES_PIPELINE_NAME?.trim() || 'Vendas OFP';
export const PROPOSAL_SENT_STAGE_NAME =
  process.env.PROPOSAL_SENT_STAGE_NAME?.trim() || 'Proposta enviada';
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/proposals/proposals.constants.ts
git commit -m "feat(proposals): constantes de pipeline/etapa alvo da proposta"
```

---

## Task 2: `PipelinesService.enterStageForConversation` (TDD)

**Files:**
- Create: `src/modules/pipelines/pipelines.enter-stage.spec.ts`
- Modify: `src/modules/pipelines/pipelines.service.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/modules/pipelines/pipelines.enter-stage.spec.ts`:

```ts
import { PipelinesService } from './pipelines.service';

function makeService() {
  const prisma = {
    pipeline: { findFirst: jest.fn() },
    pipelineStage: { findFirst: jest.fn() },
    card: { findFirst: jest.fn() },
  } as any;
  const realtime = { emitToOrg: jest.fn() } as any;
  const cadenceRunner = {
    maybeStartForStage: jest.fn().mockResolvedValue(null),
  } as any;
  const service = new PipelinesService(prisma, realtime, cadenceRunner);
  return { service, prisma, realtime, cadenceRunner };
}

const opts = { pipelineName: 'Vendas OFP', stageName: 'Proposta enviada' };

describe('PipelinesService.enterStageForConversation', () => {
  it('pipeline não encontrado → no-op', async () => {
    const { service, prisma, cadenceRunner } = makeService();
    prisma.pipeline.findFirst.mockResolvedValue(null);
    const move = jest.spyOn(service, 'moveCard').mockResolvedValue(undefined as any);
    const create = jest.spyOn(service, 'createCard').mockResolvedValue(undefined as any);

    await service.enterStageForConversation('conv-1', 'org-1', opts);

    expect(move).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(cadenceRunner.maybeStartForStage).not.toHaveBeenCalled();
  });

  it('etapa não encontrada → no-op', async () => {
    const { service, prisma } = makeService();
    prisma.pipeline.findFirst.mockResolvedValue({ id: 'pipe-1' });
    prisma.pipelineStage.findFirst.mockResolvedValue(null);
    const move = jest.spyOn(service, 'moveCard').mockResolvedValue(undefined as any);

    await service.enterStageForConversation('conv-1', 'org-1', opts);

    expect(move).not.toHaveBeenCalled();
  });

  it('card já na etapa → idempotente (não move)', async () => {
    const { service, prisma, cadenceRunner } = makeService();
    prisma.pipeline.findFirst.mockResolvedValue({ id: 'pipe-1' });
    prisma.pipelineStage.findFirst.mockResolvedValue({ id: 'stage-ps' });
    prisma.card.findFirst.mockResolvedValue({ id: 'card-1', stageId: 'stage-ps' });
    const move = jest.spyOn(service, 'moveCard').mockResolvedValue(undefined as any);

    await service.enterStageForConversation('conv-1', 'org-1', opts);

    expect(move).not.toHaveBeenCalled();
    expect(cadenceRunner.maybeStartForStage).not.toHaveBeenCalled();
  });

  it('card em outra etapa → move para a etapa alvo', async () => {
    const { service, prisma } = makeService();
    prisma.pipeline.findFirst.mockResolvedValue({ id: 'pipe-1' });
    prisma.pipelineStage.findFirst.mockResolvedValue({ id: 'stage-ps' });
    prisma.card.findFirst.mockResolvedValue({ id: 'card-1', stageId: 'stage-coleta' });
    const move = jest.spyOn(service, 'moveCard').mockResolvedValue(undefined as any);

    await service.enterStageForConversation('conv-1', 'org-1', opts);

    expect(move).toHaveBeenCalledWith('card-1', 'org-1', {
      toStageId: 'stage-ps',
      toIndex: 0,
    });
  });

  it('sem card → cria na etapa e dispara cadência', async () => {
    const { service, prisma, cadenceRunner } = makeService();
    prisma.pipeline.findFirst.mockResolvedValue({ id: 'pipe-1' });
    prisma.pipelineStage.findFirst.mockResolvedValue({ id: 'stage-ps' });
    prisma.card.findFirst.mockResolvedValue(null);
    const create = jest
      .spyOn(service, 'createCard')
      .mockResolvedValue({ id: 'card-new' } as any);

    await service.enterStageForConversation('conv-1', 'org-1', opts);

    expect(create).toHaveBeenCalledWith('pipe-1', 'org-1', {
      conversationId: 'conv-1',
      stageId: 'stage-ps',
    });
    expect(cadenceRunner.maybeStartForStage).toHaveBeenCalledWith(
      'conv-1',
      'card-new',
      'stage-ps',
      'org-1',
    );
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/pipelines/pipelines.enter-stage.spec.ts`
Expected: FAIL — `service.enterStageForConversation is not a function`.

- [ ] **Step 3: Implementar o método**

Em `src/modules/pipelines/pipelines.service.ts`, adicionar o método dentro da classe, logo depois de `moveCard` (após a linha `}` que fecha `moveCard`, antes de `removeCard` ou de outro método — qualquer posição dentro da classe serve). Usa `CreateCardDto` e `MoveCardDto` já importados no arquivo (imports do topo, linhas 14+).

```ts
  /**
   * Coloca a conversa numa etapa nomeada de um pipeline nomeado (find-or-create
   * do card + move). Move dispara a cadência (STAGE_ENTER); no caminho de
   * create, dispara explicitamente porque createCard não dispara sozinho.
   * Idempotente: se o card já está na etapa, no-op. Degrada graciosamente:
   * pipeline/etapa inexistente → log + return (não lança).
   */
  async enterStageForConversation(
    conversationId: string,
    organizationId: string,
    opts: { pipelineName: string; stageName: string },
  ): Promise<void> {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: {
        organizationId,
        archived: false,
        name: { equals: opts.pipelineName, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (!pipeline) {
      this.logger.warn(
        `enterStage: pipeline "${opts.pipelineName}" não encontrado org=${organizationId}`,
      );
      return;
    }

    const stage = await this.prisma.pipelineStage.findFirst({
      where: {
        pipelineId: pipeline.id,
        name: { equals: opts.stageName, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (!stage) {
      this.logger.warn(
        `enterStage: etapa "${opts.stageName}" não encontrada pipeline=${pipeline.id}`,
      );
      return;
    }

    const card = await this.prisma.card.findFirst({
      where: { pipelineId: pipeline.id, conversationId },
      select: { id: true, stageId: true },
    });

    if (card) {
      if (card.stageId === stage.id) return; // idempotente
      await this.moveCard(card.id, organizationId, {
        toStageId: stage.id,
        toIndex: 0,
      } as MoveCardDto);
      return;
    }

    // Sem card → cria já na etapa e dispara a cadência (createCard não dispara).
    const created = await this.createCard(pipeline.id, organizationId, {
      conversationId,
      stageId: stage.id,
    } as CreateCardDto);
    await this.cadenceRunner
      .maybeStartForStage(conversationId, created.id, stage.id, organizationId)
      .catch((err) =>
        this.logger.warn(
          `enterStage cadence_failed card=${created.id}: ${(err as Error).message}`,
        ),
      );
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/pipelines/pipelines.enter-stage.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/pipelines/pipelines.service.ts src/modules/pipelines/pipelines.enter-stage.spec.ts
git commit -m "feat(pipelines): enterStageForConversation (find-or-create card + move + cadência)"
```

---

## Task 3: Wire `ProposalsService` → avança etapa após envio (TDD)

**Files:**
- Modify: `src/modules/proposals/proposals.service.spec.ts`
- Modify: `src/modules/proposals/proposals.service.ts`
- Modify: `src/modules/proposals/proposals.module.ts`

- [ ] **Step 1: Atualizar o spec (deps + construtor) e adicionar testes que falham**

Em `src/modules/proposals/proposals.service.spec.ts`:

(a) No `return { ... }` de `deps()`, adicionar a chave `pipelines` (depois de `messages`):

```ts
    messages: { send: jest.fn().mockResolvedValue({ id: 'msg-1' }) } as any,
    pipelines: { enterStageForConversation: jest.fn().mockResolvedValue(undefined) } as any,
```

(b) Substituir TODAS as ocorrências de:

```ts
new ProposalsService(d.prisma, d.render, d.extraction, d.repo, d.messages)
```

por:

```ts
new ProposalsService(d.prisma, d.render, d.extraction, d.repo, d.messages, d.pipelines)
```

(Comando: `sed -i '' 's/d.repo, d.messages)/d.repo, d.messages, d.pipelines)/g' src/modules/proposals/proposals.service.spec.ts`)

(c) Adicionar dois testes novos dentro do `describe('ProposalsService', ...)`:

```ts
  it('avança o card para "Proposta enviada" depois de enviar', async () => {
    const d = deps();
    const service = new ProposalsService(
      d.prisma, d.render, d.extraction, d.repo, d.messages, d.pipelines,
    );

    await service.create(
      { conversationId: 'conv-1', checkoutUrl: url },
      'user-1', 'org-1', 'ALL' as any,
    );

    expect(d.pipelines.enterStageForConversation).toHaveBeenCalledWith(
      'conv-1',
      'org-1',
      { pipelineName: 'Vendas OFP', stageName: 'Proposta enviada' },
    );
  });

  it('não quebra o envio se o avanço de etapa falhar', async () => {
    const d = deps();
    d.pipelines.enterStageForConversation.mockRejectedValue(new Error('boom'));
    const service = new ProposalsService(
      d.prisma, d.render, d.extraction, d.repo, d.messages, d.pipelines,
    );

    const result = await service.create(
      { conversationId: 'conv-1', checkoutUrl: url },
      'user-1', 'org-1', 'ALL' as any,
    );

    expect(d.messages.send).toHaveBeenCalled();
    expect(result).toEqual({ id: 'prop-1' });
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/proposals/proposals.service.spec.ts`
Expected: FAIL — construtor recebe 6º arg não usado / `enterStageForConversation` não chamado.

- [ ] **Step 3: Implementar**

Em `src/modules/proposals/proposals.service.ts`:

(a) Adicionar imports no topo (junto aos outros imports):

```ts
import { PipelinesService } from '../pipelines/pipelines.service';
import {
  PROPOSAL_ALLOWED_HOSTS,
  PROPOSAL_SENT_PIPELINE_NAME,
  PROPOSAL_SENT_STAGE_NAME,
} from './proposals.constants';
```

(substitui o import atual `import { PROPOSAL_ALLOWED_HOSTS } from './proposals.constants';`)

(b) Adicionar o 6º parâmetro no construtor (depois de `messages`):

```ts
    private readonly messages: MessagesService,
    private readonly pipelines: PipelinesService,
  ) {}
```

(c) Depois do bloco `await this.messages.send(...)` (linha ~93) e **antes** do `return proposal;`, inserir:

```ts
    // Glue Etapa 4: proposta enviada → card entra em "Proposta enviada",
    // o que dispara a cadência. Isolado do envio: falha aqui não derruba a
    // proposta já entregue/persistida.
    try {
      await this.pipelines.enterStageForConversation(
        conversation.id,
        organizationId,
        {
          pipelineName: PROPOSAL_SENT_PIPELINE_NAME,
          stageName: PROPOSAL_SENT_STAGE_NAME,
        },
      );
    } catch (err) {
      this.logger.warn(
        `proposal_stage_advance_failed conv=${conversation.id}: ${(err as Error).message}`,
      );
    }
```

- [ ] **Step 4: Wire o módulo**

Em `src/modules/proposals/proposals.module.ts`, adicionar o import de `PipelinesModule`:

```ts
import { PipelinesModule } from '../pipelines/pipelines.module';
```

e incluí-lo em `imports`:

```ts
  imports: [LlmModule, MessagingModule, PipelinesModule],
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx jest src/modules/proposals/proposals.service.spec.ts`
Expected: PASS (todos, incluindo os 2 novos e os antigos).

- [ ] **Step 6: Commit**

```bash
git add src/modules/proposals/proposals.service.ts src/modules/proposals/proposals.service.spec.ts src/modules/proposals/proposals.module.ts
git commit -m "feat(proposals): avança card para Proposta enviada + dispara cadência após envio"
```

---

## Task 4: Build + suíte cheia dos módulos tocados

- [ ] **Step 1: Typecheck/build**

Run: `npx tsc --noEmit -p tsconfig.json` (ou `yarn build`)
Expected: sem erros.

- [ ] **Step 2: Rodar os specs dos dois módulos**

Run: `npx jest src/modules/proposals src/modules/pipelines`
Expected: PASS.

- [ ] **Step 3: Commit final (se algo de lint/tsc mudou)**

```bash
git add -A && git commit -m "chore(proposals): fatia 1 verde (build + testes)" || echo "nada a commitar"
```

---

## Depois do plano (não é tarefa de código)

- Abrir PR na `feat/conversation-tabs` (via `gh pr create`, base `fork/feat/conversation-tabs`).
- Deploy no VPS: `docker compose up -d --build` (git reset ANTES do build — pegadinha conhecida).
- **Config de ambiente:** confirmar que a org tem um pipeline "Vendas OFP" com etapa "Proposta enviada" (ou setar `SALES_PIPELINE_NAME`/`PROPOSAL_SENT_STAGE_NAME` no compose). Sem isso, o glue degrada gracioso (log + segue) e a cadência não inicia.
- **E2E:** ✈️ → colar link do carrinho → verificar (1) proposta enviada ao cliente, (2) card em "Proposta enviada", (3) cadência agendada.
