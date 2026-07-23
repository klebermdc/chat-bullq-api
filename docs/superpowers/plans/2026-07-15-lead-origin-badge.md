# Origem do Lead no Card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar um selo de origem em todo card do lead (board + Card do Cliente) e permitir corrigir a origem à mão.

**Architecture:** Origem via tags de conversa (sem migração). Tag explícita `Instagram Orgânico` vence; senão fallback pelo canal. `getBoard` passa a serializar `conversation.tags`; um endpoint novo `PUT /conversations/:id/origin` define a origem de forma single-valued. O front resolve o selo com um helper puro e renderiza no mini-card e no panorama, com seletor de correção no panorama.

**Tech Stack:** NestJS + Prisma + Jest (API); Next.js + React Query + TypeScript (web). Web não tem test runner — verificação via `tsc` + app rodando.

**Worktrees (já criadas, base `fork/feat/conversation-tabs`):**
- API: `chat-bullq-api/.worktrees/lead-origin` (branch `feat/lead-origin-badge`)
- Web: `chat-bullq-web/.worktrees/lead-origin` (branch `feat/lead-origin-badge`)

Todos os caminhos abaixo são relativos à raiz de cada worktree.

---

## Task 1: Constante canônica de origem + refactor do tagger (API)

**Files:**
- Create: `src/modules/messaging/pipeline/lead-origin.constants.ts`
- Modify: `src/modules/messaging/pipeline/lead-source-tagger.service.ts:5` (usa a constante)
- Test: `src/modules/messaging/pipeline/lead-source-tagger.service.spec.ts` (já existe; deve continuar verde)

- [ ] **Step 1: Criar a constante compartilhada**

Create `src/modules/messaging/pipeline/lead-origin.constants.ts`:
```ts
/** Chaves canônicas de origem de lead. AD/SITE são reservadas p/ CTWA/Site (futuro). */
export type LeadOriginKey = 'INSTAGRAM_ORGANIC' | 'AD' | 'SITE';

/** Nome da tag de conversa que representa cada origem. Fonte única da verdade. */
export const ORIGIN_TAG_NAMES: Record<LeadOriginKey, string> = {
  INSTAGRAM_ORGANIC: 'Instagram Orgânico',
  AD: 'Anúncio',
  SITE: 'Site',
};

/** Todos os nomes de tag que representam origem (para limpar ao trocar). */
export const ALL_ORIGIN_TAG_NAMES: string[] = Object.values(ORIGIN_TAG_NAMES);
```

- [ ] **Step 2: Apontar o tagger para a constante**

In `src/modules/messaging/pipeline/lead-source-tagger.service.ts`, replace line 5:
```ts
const INSTAGRAM_TAG_NAME = 'Instagram Orgânico';
```
with:
```ts
import { ORIGIN_TAG_NAMES } from './lead-origin.constants';

const INSTAGRAM_TAG_NAME = ORIGIN_TAG_NAMES.INSTAGRAM_ORGANIC;
```
(coloque o `import` junto aos outros imports no topo; mantenha a const usando o valor importado para não tocar o resto do arquivo.)

- [ ] **Step 3: Rodar o spec do tagger (regressão)**

Run: `npx jest lead-source-tagger --silent`
Expected: PASS (a tag continua `'Instagram Orgânico'`, agora vinda da constante).

- [ ] **Step 4: Commit**

```bash
git add src/modules/messaging/pipeline/lead-origin.constants.ts src/modules/messaging/pipeline/lead-source-tagger.service.ts
git commit -m "refactor(lead-origin): constante canônica de origem compartilhada com o tagger"
```

---

## Task 2: `getBoard` serializa `conversation.tags` (API)

**Files:**
- Modify: `src/modules/pipelines/pipelines.service.ts:94-105` (include do board)

Não há teste unitário de `getBoard` sem DB no repo (os specs de pipeline testam outras rotas). Esta mudança é um `select` aditivo de baixo risco; a verificação real é o `nest build` (Task 5) + o app puxando as tags (Task 7/8) + E2E.

- [ ] **Step 1: Adicionar `tags` ao select da conversa**

In `src/modules/pipelines/pipelines.service.ts`, dentro de `getBoard`, no `include.conversation.select` (hoje termina com a linha `channel: { select: { id: true, type: true, name: true } },`), adicione **abaixo** dessa linha:
```ts
              // Tags da conversa — a UI deriva a ORIGEM do lead (ex.: "Instagram
              // Orgânico") a partir daqui; sem isso o selo de origem fica cego.
              tags: {
                select: {
                  tag: { select: { id: true, name: true, color: true } },
                },
              },
```

- [ ] **Step 2: Type-check parcial**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: sem erros novos referentes a `pipelines.service.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/pipelines/pipelines.service.ts
git commit -m "feat(pipelines): getBoard serializa conversation.tags (base da origem no card)"
```

---

## Task 3: `LeadOriginService.setOrigin` (API, TDD)

Serviço fino que define a origem de forma **single-valued** e **idempotente**, escrevendo direto no Prisma (espelha o tagger; NÃO usa `TagsService` para não disparar automações `TAG_ADDED/REMOVED`).

**Files:**
- Create: `src/modules/messaging/pipeline/lead-origin.service.ts`
- Test: `src/modules/messaging/pipeline/lead-origin.service.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Create `src/modules/messaging/pipeline/lead-origin.service.spec.ts`:
```ts
import { NotFoundException } from '@nestjs/common';
import { LeadOriginService } from './lead-origin.service';

function make() {
  const prisma = {
    conversation: { findFirst: jest.fn().mockResolvedValue({ id: 'conv-1' }) },
    tag: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({ id: 'tag-ig' }),
    },
    conversationTag: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
    },
  } as any;
  return { service: new LeadOriginService(prisma), prisma };
}

describe('LeadOriginService.setOrigin', () => {
  it('INSTAGRAM_ORGANIC: upsert da tag + link na conversa', async () => {
    const { service, prisma } = make();
    await service.setOrigin('org-1', 'conv-1', 'INSTAGRAM_ORGANIC');
    expect(prisma.tag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_name: { organizationId: 'org-1', name: 'Instagram Orgânico' } },
      }),
    );
    expect(prisma.conversationTag.create).toHaveBeenCalledWith({
      data: { conversationId: 'conv-1', tagId: 'tag-ig' },
    });
  });

  it('WHATSAPP_DIRECT: remove tags de origem e NÃO cria link', async () => {
    const { service, prisma } = make();
    prisma.tag.findMany.mockResolvedValue([{ id: 'tag-ig', name: 'Instagram Orgânico' }]);
    await service.setOrigin('org-1', 'conv-1', 'WHATSAPP_DIRECT');
    expect(prisma.conversationTag.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', tagId: { in: ['tag-ig'] } },
    });
    expect(prisma.conversationTag.create).not.toHaveBeenCalled();
    expect(prisma.tag.upsert).not.toHaveBeenCalled();
  });

  it('trocar origem: limpa a anterior antes de aplicar a nova (idempotente)', async () => {
    const { service, prisma } = make();
    prisma.tag.findMany.mockResolvedValue([{ id: 'tag-ig', name: 'Instagram Orgânico' }]);
    await service.setOrigin('org-1', 'conv-1', 'INSTAGRAM_ORGANIC');
    expect(prisma.conversationTag.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', tagId: { in: ['tag-ig'] } },
    });
    expect(prisma.conversationTag.create).toHaveBeenCalled();
  });

  it('conversa de outra org: 404', async () => {
    const { service, prisma } = make();
    prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(service.setOrigin('org-x', 'conv-1', 'INSTAGRAM_ORGANIC')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
```

- [ ] **Step 2: Rodar o teste (deve falhar)**

Run: `npx jest lead-origin.service --silent`
Expected: FAIL — `Cannot find module './lead-origin.service'`.

- [ ] **Step 3: Implementar o serviço**

Create `src/modules/messaging/pipeline/lead-origin.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import {
  ALL_ORIGIN_TAG_NAMES,
  LeadOriginKey,
  ORIGIN_TAG_NAMES,
} from './lead-origin.constants';

/** Escolha de origem aceita pela correção manual. WHATSAPP_DIRECT = sem tag (fallback). */
export type LeadOriginChoice = LeadOriginKey | 'WHATSAPP_DIRECT';

/**
 * Define a ORIGEM de um lead de forma single-valued: no máximo uma tag de origem
 * por conversa. Idempotente (remove as de origem e reaplica a escolhida).
 * Escreve direto no Prisma para NÃO disparar automações de tag.
 */
@Injectable()
export class LeadOriginService {
  constructor(private readonly prisma: PrismaService) {}

  async setOrigin(
    organizationId: string,
    conversationId: string,
    origin: LeadOriginChoice,
  ): Promise<{ tags: { id: string; name: string }[] }> {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
      select: { id: true },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    // Tags de origem que EXISTEM nesta org (para saber o que limpar).
    const originTags = await this.prisma.tag.findMany({
      where: { organizationId, name: { in: ALL_ORIGIN_TAG_NAMES } },
      select: { id: true, name: true },
    });
    const originTagIds = originTags.map((t) => t.id);

    if (originTagIds.length) {
      await this.prisma.conversationTag.deleteMany({
        where: { conversationId, tagId: { in: originTagIds } },
      });
    }

    const desiredName =
      origin === 'WHATSAPP_DIRECT' ? undefined : ORIGIN_TAG_NAMES[origin];

    if (desiredName) {
      const tag = await this.prisma.tag.upsert({
        where: { organizationId_name: { organizationId, name: desiredName } },
        update: {},
        create: { organizationId, name: desiredName },
        select: { id: true, name: true },
      });
      await this.prisma.conversationTag.create({
        data: { conversationId, tagId: tag.id },
      });
      return { tags: [{ id: tag.id, name: tag.name }] };
    }

    return { tags: [] };
  }
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

Run: `npx jest lead-origin.service --silent`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/messaging/pipeline/lead-origin.service.ts src/modules/messaging/pipeline/lead-origin.service.spec.ts
git commit -m "feat(lead-origin): LeadOriginService.setOrigin single-valued idempotente"
```

---

## Task 4: Endpoint `PUT /conversations/:id/origin` (API)

**Files:**
- Create: `src/modules/messaging/conversations/dto/set-origin.dto.ts`
- Modify: `src/modules/messaging/conversations/conversations.controller.ts` (import + rota)
- Modify: `src/modules/messaging/conversations/conversations.module.ts` (provider + import do módulo do tagger, se necessário)

- [ ] **Step 1: Criar o DTO**

Create `src/modules/messaging/conversations/dto/set-origin.dto.ts`:
```ts
import { IsIn } from 'class-validator';

/** Origens aceitas na correção manual nesta fatia (AD/SITE virão com CTWA/Site). */
export const MANUAL_ORIGINS = ['INSTAGRAM_ORGANIC', 'WHATSAPP_DIRECT'] as const;
export type ManualOrigin = (typeof MANUAL_ORIGINS)[number];

export class SetOriginDto {
  @IsIn(MANUAL_ORIGINS as unknown as string[])
  origin!: ManualOrigin;
}
```

- [ ] **Step 2: Descobrir como prover o `LeadOriginService`**

Run: `sed -n '1,60p' src/modules/messaging/conversations/conversations.module.ts`
Expected: ver os `imports`/`providers`. O `LeadOriginService` está em `messaging/pipeline`. Confirme se `conversations.module.ts` já importa o módulo que exporta serviços de `pipeline` (ex.: `MessagingModule`/pipeline module). Se **não** houver export reutilizável, adicione `LeadOriginService` diretamente em `providers` deste módulo (ele só depende de `PrismaService`, que já está disponível globalmente/no módulo).

- [ ] **Step 3: Adicionar `LeadOriginService` aos providers (se necessário)**

In `src/modules/messaging/conversations/conversations.module.ts`, adicione o import:
```ts
import { LeadOriginService } from '../pipeline/lead-origin.service';
```
e inclua `LeadOriginService` no array `providers` do `@Module`.

- [ ] **Step 4: Adicionar a rota no controller**

In `src/modules/messaging/conversations/conversations.controller.ts`:

Adicione aos imports do `@nestjs/common` o `Put` (se ainda não estiver na lista — a lista atual tem `Controller, Delete, Get, Patch, Post, Param, Body, Query, UseGuards`):
```ts
  Put,
```
Adicione os imports:
```ts
import { SetOriginDto } from './dto/set-origin.dto';
import { LeadOriginService } from '../pipeline/lead-origin.service';
```
Injete no construtor (que hoje recebe `service` e `startConversation`):
```ts
    private readonly leadOrigin: LeadOriginService,
```
Adicione a rota (perto das outras rotas `:id/...`):
```ts
  @Put(':id/origin')
  @ApiOperation({ summary: 'Define a origem do lead (correção manual): single-valued.' })
  setOrigin(
    @CurrentOrg() org: { id: string; userOrganizationId: string; userRole: OrgRole },
    @Param('id') id: string,
    @Body() dto: SetOriginDto,
  ) {
    return this.leadOrigin.setOrigin(org.id, id, dto.origin);
  }
```

- [ ] **Step 5: Build da API**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: sem erros novos. Se `@CurrentOrg()` tiver forma diferente da usada em `start`, siga o padrão real do arquivo (verifique como as outras rotas obtêm `org.id`).

- [ ] **Step 6: Commit**

```bash
git add src/modules/messaging/conversations/dto/set-origin.dto.ts src/modules/messaging/conversations/conversations.controller.ts src/modules/messaging/conversations/conversations.module.ts
git commit -m "feat(conversations): PUT /:id/origin para correção manual da origem"
```

---

## Task 5: Build + suíte da API verde

- [ ] **Step 1: Build completo**

Run: `npx nest build`
Expected: sucesso, sem erros.

- [ ] **Step 2: Rodar os testes de origem**

Run: `npx jest lead-origin lead-source-tagger --silent`
Expected: PASS.

- [ ] **Step 3: Commit (se houver ajustes)**

```bash
git commit -am "chore(lead-origin): build verde" --allow-empty
```

---

## Task 6: Tipo + helper de origem no front (Web)

Web não tem test runner; o helper é puro e será exercitado pelo `tsc` e pelo app.

**Files:**
- Modify: `src/features/pipelines/services/pipelines.service.ts` (tipo `CardSummary.conversation`)
- Create: `src/features/pipelines/lib/lead-origin.ts`

- [ ] **Step 1: Estender o tipo `CardSummary.conversation`**

In `src/features/pipelines/services/pipelines.service.ts`, dentro de `conversation?: { ... }`, abaixo do bloco `channel: {...}`, adicione:
```ts
    /** Tags da conversa — usadas p/ derivar a origem do lead. */
    tags?: {
      tag: { id: string; name: string; color: string | null };
    }[];
```

- [ ] **Step 2: Criar o helper puro**

Create `src/features/pipelines/lib/lead-origin.ts`:
```ts
import type { CardSummary } from '../services/pipelines.service';

export type LeadOriginResolved = {
  /** Chave estável (p/ o seletor de correção). */
  key: 'INSTAGRAM_ORGANIC' | 'WHATSAPP_DIRECT' | 'INSTAGRAM' | 'AD' | 'SITE';
  label: string;
  emoji: string;
};

/** Nome da tag → origem explícita. Espelha ORIGIN_TAG_NAMES da API. */
const TAG_TO_ORIGIN: Record<string, LeadOriginResolved> = {
  'Instagram Orgânico': { key: 'INSTAGRAM_ORGANIC', label: 'Instagram Orgânico', emoji: '📸' },
  Anúncio: { key: 'AD', label: 'Anúncio', emoji: '📣' },
  Site: { key: 'SITE', label: 'Site', emoji: '🌐' },
};

/**
 * Resolve a origem do lead: tag de origem explícita vence; senão, fallback pelo
 * canal. Sempre retorna algo (todo card tem selo).
 */
export function resolveLeadOrigin(card: CardSummary): LeadOriginResolved {
  const tags = card.conversation?.tags ?? [];
  for (const t of tags) {
    const hit = TAG_TO_ORIGIN[t.tag.name];
    if (hit) return hit;
  }
  const channelType = card.conversation?.channel?.type;
  if (channelType === 'INSTAGRAM') {
    return { key: 'INSTAGRAM', label: 'Instagram', emoji: '📸' };
  }
  return { key: 'WHATSAPP_DIRECT', label: 'WhatsApp direto', emoji: '💬' };
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add src/features/pipelines/services/pipelines.service.ts src/features/pipelines/lib/lead-origin.ts
git commit -m "feat(pipelines): tipo de tags + helper resolveLeadOrigin"
```

---

## Task 7: Selo de origem no mini-card (Web)

**Files:**
- Modify: `src/features/pipelines/components/kanban-card.tsx`

> ⚠️ Já existe uma variável `origin` no arquivo (label do Kirvano). Use o nome `leadOrigin` para não colidir.

- [ ] **Step 1: Importar o helper e resolver a origem**

In `src/features/pipelines/components/kanban-card.tsx`, adicione o import:
```ts
import { resolveLeadOrigin } from '../lib/lead-origin';
```
No corpo do componente (onde `origin`/`value`/`kirvano` são derivados do `card`), adicione:
```ts
  const leadOrigin = resolveLeadOrigin(card);
```

- [ ] **Step 2: Renderizar o chip ao lado do termômetro**

Ainda no bloco de selos (`<div className="mt-2 flex flex-wrap ...">`), logo **após** o bloco do termômetro (`{card.conversation?.temperature ? (...) : null}`), insira:
```tsx
        <span
          className="inline-flex items-center gap-1 rounded-full bg-fuchsia-50 px-2 py-0.5 text-[10px] font-medium text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-300"
          title="Origem do lead"
        >
          {leadOrigin.emoji} {leadOrigin.label}
        </span>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add src/features/pipelines/components/kanban-card.tsx
git commit -m "feat(pipelines): selo de origem no mini-card do board"
```

---

## Task 8: Origem + correção manual no Card do Cliente (Web)

**Files:**
- Modify: `src/features/pipelines/services/pipelines.service.ts` (método `setOrigin`)
- Modify: `src/features/pipelines/components/client-card-dialog.tsx` (section + seletor)

- [ ] **Step 1: Método de API no service do front**

In `src/features/pipelines/services/pipelines.service.ts`, adicione ao objeto `pipelinesService` (perto de `getBoard`) um método que chama o endpoint novo. Siga o cliente HTTP já usado no arquivo (o mesmo de `getBoard`; ex.: `api.put(...)` retornando `data.data`/`data`):
```ts
  async setOrigin(conversationId: string, origin: 'INSTAGRAM_ORGANIC' | 'WHATSAPP_DIRECT') {
    const { data } = await api.put(`/conversations/${conversationId}/origin`, { origin });
    return data;
  },
```
(Ajuste `api`/desestruturação ao padrão real do arquivo — verifique como `getBoard` faz a chamada.)

- [ ] **Step 2: Mostrar a origem no cabeçalho do panorama**

In `src/features/pipelines/components/client-card-dialog.tsx`, importe o helper:
```ts
import { resolveLeadOrigin } from '../lib/lead-origin';
```
Resolva no corpo (perto de onde lê `card.conversation`):
```ts
  const leadOrigin = card ? resolveLeadOrigin(card) : null;
```
No cabeçalho (perto do bloco de termômetro/telefone/valor), adicione uma linha:
```tsx
        {leadOrigin && (
          <div className="mt-1 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
            <span className="font-medium text-zinc-600 dark:text-zinc-300">Origem:</span>
            <span>{leadOrigin.emoji} {leadOrigin.label}</span>
          </div>
        )}
```

- [ ] **Step 3: Seletor de correção manual**

Ainda no `client-card-dialog.tsx`, adicione um `<select>` de correção (usar React Query `useMutation` + invalidar `['pipeline-board', pipelineId]`; siga o padrão de mutation já usado no componente para proposta/summary). Insira abaixo da linha de origem:
```tsx
        {card?.conversation?.id && (
          <select
            aria-label="Corrigir origem do lead"
            className="mt-1 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
            value={leadOrigin?.key === 'INSTAGRAM_ORGANIC' ? 'INSTAGRAM_ORGANIC' : 'WHATSAPP_DIRECT'}
            onChange={(e) => setOriginMutation.mutate(e.target.value as 'INSTAGRAM_ORGANIC' | 'WHATSAPP_DIRECT')}
            disabled={setOriginMutation.isPending}
          >
            <option value="WHATSAPP_DIRECT">WhatsApp direto</option>
            <option value="INSTAGRAM_ORGANIC">Instagram Orgânico</option>
          </select>
        )}
```
Defina a mutation no componente (siga o `queryClient`/`useMutation` já importados; se não estiverem, importe de `@tanstack/react-query`):
```ts
  const queryClient = useQueryClient();
  const setOriginMutation = useMutation({
    mutationFn: (origin: 'INSTAGRAM_ORGANIC' | 'WHATSAPP_DIRECT') =>
      pipelinesService.setOrigin(card!.conversation!.id, origin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipeline-board'] });
    },
  });
```
(Se o componente já recebe `pipelineId`, use `['pipeline-board', pipelineId]` na invalidação para bater com a queryKey do board em `kanban-board.tsx`.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add src/features/pipelines/services/pipelines.service.ts src/features/pipelines/components/client-card-dialog.tsx
git commit -m "feat(pipelines): origem + correção manual no Card do Cliente"
```

---

## Task 9: Verificação final (Web) + handoff de deploy

- [ ] **Step 1: Type-check web completo**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 2: Build web (se rápido no ambiente)**

Run: `npm run build 2>&1 | tail -20`
Expected: build ok (ou pular se muito longo — `tsc` já cobre tipos).

- [ ] **Step 3: Verificação manual (app rodando)**

Subir `next dev` (conta de teste), abrir um pipeline com a Priscila:
- mini-card mostra chip de origem (ela cairá em "WhatsApp direto" se não tiver a tag);
- abrir o Card do Cliente → linha "Origem" + seletor;
- trocar pra "Instagram Orgânico" → selo atualiza no card e no board (invalidação da query).

- [ ] **Step 4: Push + PRs (nunca push direto na branch viva)**

```bash
# API
git -C <api-worktree> push -u fork feat/lead-origin-badge
# Web
git -C <web-worktree> push -u fork feat/lead-origin-badge
```
Abrir 2 PRs no fork `klebermdc`, base `feat/conversation-tabs`. Sem migração. Depois: rebuild no VPS + E2E no celular/desktop.

---

## Notas de execução / pegadinhas
- **Sem migração** — só leitura de tag + select + escrita via tag existente.
- Tagger `Instagram Orgânico` já está vivo em `fork/feat/conversation-tabs` (confirmado) — não levar #61.
- O nome de var no mini-card é `leadOrigin` (não `origin`, que já é do Kirvano).
- `LeadOriginService` escreve direto no Prisma de propósito (não via `TagsService`) para não disparar automações `TAG_ADDED/REMOVED`.
- A queryKey do board é `['pipeline-board', pipelineId]` (`kanban-board.tsx`) — a invalidação precisa bater com ela.
- Verifique o padrão real do cliente HTTP do front (`api`) e de `@CurrentOrg()` no controller antes de colar — ajuste ao arquivo.
