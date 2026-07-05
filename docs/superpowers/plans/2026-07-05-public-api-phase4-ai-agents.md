# Public API — Fase 4 (AI Agents read-only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor, somente leitura, `GET /public/ai-agents`, `GET /:id` e `GET /:id/runs` na API pública, via um service isolado que só usa `PrismaService`, com mappers allowlist que nunca vazam `systemPrompt`/`modelParams`/`toolCalls`.

**Architecture:** Controllers finos `public/*` + mappers allowlist (padrão Fases 1–3). `PublicAiAgentsService` (injeta só `PrismaService`) espelha 3 queries de leitura — NÃO importa o `AiAgentsModule` pesado. **Aditivo, read-only.**

**Tech Stack:** NestJS 11, Prisma 6, Jest (specs colocados com mocks).

**Worktree:** trabalhar em `chat-bullq-api-phase4/` (branch `feat/public-api-phase4`, isolada, baseada em `feat/public-api-phase3`). NÃO tocar no checkout principal `chat-bullq-api/`.

---

## Convenções verificadas (não re-derivar)

- Guards: `@UseGuards(ApiKeyAuthGuard, ApiKeyThrottleGuard)` (`ApiKeyAuthGuard` de `../../../common/guards`; `ApiKeyThrottleGuard` de `../guards/api-key-throttle.guard`), `@ApiSecurity('api-key')`, org de `@CurrentOrg('id')` (`../../../common/decorators`).
- `PrismaService` em `../../../database/prisma.service`; `PrismaModule` é `@Global` (não precisa importar).
- `PublicApiModule` em `src/modules/public-api/public-api.module.ts` (já registra controllers Fases 1–3).
- **AiAgent** (campos relevantes): `id, organizationId, name, description?, avatarUrl?, kind, category?, capabilities (String[]), parentAgentId?, department?, squad?, modelId, modelParams?, systemPrompt, operationalContext?, operationalContextUpdatedAt?, temperature, maxTokens, canRespondDirectly, isActive, followUpCadenceHours (Int[]), createdAt, deletedAt?`. Relação `channels` (AiAgentChannel[]) — o service inclui `channels.channel { id, name, type }`.
- **AiAgentRun** (campos): `id, organizationId, conversationId, agentId, triggerMessageId?, status, finalAction?, errorMessage?, modelId, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, costUsd (Decimal), durationMs?, classifiedIntent?, classifierConfidence? (Decimal), skippedOrchestrator, startedAt, finishedAt?`. Relação `toolCalls` (AiToolCall[]).
- `costUsd` é `Prisma.Decimal` → converter com `Number(x)` no mapper (NÃO serializar o objeto cru).
- Test: `*.spec.ts` colocado, instanciar classe com mocks. `yarn test <path>`.

---

## Estrutura de arquivos

```
src/modules/public-api/
  public-api.module.ts                        # MODIFICAR: + PublicAiAgentsController, + PublicAiAgentsService provider
  mappers/
    ai-agent.mapper.ts                        # CRIAR (+ .spec.ts)
    ai-agent-run.mapper.ts                    # CRIAR (+ .spec.ts)
  dto/
    list-agent-runs.public.dto.ts             # CRIAR
  ai-agents/
    public-ai-agents.service.ts               # CRIAR (+ .spec.ts)
  controllers/
    public-ai-agents.controller.ts            # CRIAR
```

---

## Task 1: AI-agent mapper (allowlist)

**Files:**
- Create: `src/modules/public-api/mappers/ai-agent.mapper.ts`
- Test: `src/modules/public-api/mappers/ai-agent.mapper.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// ai-agent.mapper.spec.ts
import { mapAiAgent } from './ai-agent.mapper';

describe('mapAiAgent', () => {
  const raw = {
    id: 'ag1', organizationId: 'o', name: 'Vendas Bot', description: 'vende', avatarUrl: 'http://x/a.png',
    kind: 'WORKER', category: 'sales', capabilities: ['reply', 'offer'], parentAgentId: 'ceo1',
    department: 'VENDAS', squad: 'Inbound', modelId: 'claude-sonnet-5', isActive: true,
    canRespondDirectly: true, createdAt: new Date('2026-01-01'), deletedAt: null,
    // sensíveis — NÃO podem vazar:
    systemPrompt: 'VOCÊ É ...', operationalContext: 'hoje teve aula ...', modelParams: { topP: 0.9 },
    temperature: 0.7, maxTokens: 2048, followUpCadenceHours: [4, 24],
    channels: [{ channel: { id: 'ch1', name: 'WhatsApp', type: 'WHATSAPP_CLOUD' } }],
  };

  it('expõe só metadados seguros e NUNCA vaza systemPrompt/operationalContext/modelParams', () => {
    const out = mapAiAgent(raw as any);
    expect(out).toEqual({
      id: 'ag1', name: 'Vendas Bot', description: 'vende', avatarUrl: 'http://x/a.png',
      kind: 'WORKER', category: 'sales', department: 'VENDAS', squad: 'Inbound', parentAgentId: 'ceo1',
      capabilities: ['reply', 'offer'], isActive: true, canRespondDirectly: true,
      modelId: 'claude-sonnet-5', createdAt: new Date('2026-01-01'),
      channels: [{ id: 'ch1', name: 'WhatsApp', type: 'WHATSAPP_CLOUD' }],
    });
    expect((out as any).systemPrompt).toBeUndefined();
    expect((out as any).operationalContext).toBeUndefined();
    expect((out as any).modelParams).toBeUndefined();
    expect((out as any).temperature).toBeUndefined();
    expect((out as any).maxTokens).toBeUndefined();
    expect((out as any).organizationId).toBeUndefined();
  });

  it('tolera agente sem channels', () => {
    const out = mapAiAgent({ id: 'ag2', name: 'x', kind: 'WORKER', capabilities: [], isActive: true, canRespondDirectly: false, modelId: 'm', createdAt: new Date() } as any);
    expect(out.channels).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/modules/public-api/mappers/ai-agent.mapper.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// ai-agent.mapper.ts
export interface PublicAiAgent {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  kind: string;
  category: string | null;
  department: string | null;
  squad: string | null;
  parentAgentId: string | null;
  capabilities: string[];
  isActive: boolean;
  canRespondDirectly: boolean;
  modelId: string;
  createdAt: Date;
  channels: { id: string; name: string; type: string }[];
}

// Allowlist: só os campos abaixo saem. systemPrompt/operationalContext/modelParams/
// temperature/maxTokens/followUpCadenceHours são omitidos por construção (PI + tuning).
export function mapAiAgent(a: any): PublicAiAgent {
  return {
    id: a.id,
    name: a.name,
    description: a.description ?? null,
    avatarUrl: a.avatarUrl ?? null,
    kind: a.kind,
    category: a.category ?? null,
    department: a.department ?? null,
    squad: a.squad ?? null,
    parentAgentId: a.parentAgentId ?? null,
    capabilities: a.capabilities ?? [],
    isActive: a.isActive,
    canRespondDirectly: a.canRespondDirectly,
    modelId: a.modelId,
    createdAt: a.createdAt,
    channels: (a.channels ?? []).map((c: any) => ({ id: c.channel?.id, name: c.channel?.name, type: c.channel?.type })),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/modules/public-api/mappers/ai-agent.mapper.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/public-api/mappers/ai-agent.mapper.ts src/modules/public-api/mappers/ai-agent.mapper.spec.ts
git commit -m "feat(public-api): add ai-agent mapper (allowlist, no prompts)"
```

---

## Task 2: AI-agent-run mapper

**Files:**
- Create: `src/modules/public-api/mappers/ai-agent-run.mapper.ts`
- Test: `src/modules/public-api/mappers/ai-agent-run.mapper.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// ai-agent-run.mapper.spec.ts
import { mapAiAgentRun } from './ai-agent-run.mapper';

describe('mapAiAgentRun', () => {
  const raw = {
    id: 'r1', organizationId: 'o', conversationId: 'cv1', agentId: 'ag1', triggerMessageId: 'm1',
    status: 'COMPLETED', finalAction: 'REPLIED', errorMessage: null, modelId: 'claude-sonnet-5',
    inputTokens: 1200, outputTokens: 300, cacheReadTokens: 800, cacheWriteTokens: 0,
    costUsd: { toString: () => '0.004521', valueOf: () => 0.004521 }, // simula Prisma.Decimal
    durationMs: 850, classifiedIntent: 'buy', classifierConfidence: { toString: () => '0.92' },
    startedAt: new Date('2026-03-01T10:00:00Z'), finishedAt: new Date('2026-03-01T10:00:01Z'),
    _count: { toolCalls: 3 },
  };

  it('expõe métricas públicas, converte costUsd para number e usa a contagem de toolCalls', () => {
    const out = mapAiAgentRun(raw as any);
    expect(out).toEqual({
      id: 'r1', conversationId: 'cv1', agentId: 'ag1', status: 'COMPLETED', finalAction: 'REPLIED',
      modelId: 'claude-sonnet-5', inputTokens: 1200, outputTokens: 300, costUsd: 0.004521, durationMs: 850,
      classifiedIntent: 'buy', startedAt: new Date('2026-03-01T10:00:00Z'), finishedAt: new Date('2026-03-01T10:00:01Z'),
      toolCallsCount: 3,
    });
    expect((out as any).errorMessage).toBeUndefined();
    expect((out as any).triggerMessageId).toBeUndefined();
    expect((out as any).organizationId).toBeUndefined();
  });

  it('toolCallsCount default 0 e costUsd tolerante a null', () => {
    const out = mapAiAgentRun({ id: 'r2', conversationId: 'c', agentId: 'a', status: 'RUNNING', modelId: 'm', inputTokens: 0, outputTokens: 0, costUsd: null, startedAt: new Date() } as any);
    expect(out.toolCallsCount).toBe(0);
    expect(out.costUsd).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/modules/public-api/mappers/ai-agent-run.mapper.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// ai-agent-run.mapper.ts
export interface PublicAiAgentRun {
  id: string;
  conversationId: string;
  agentId: string;
  status: string;
  finalAction: string | null;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number | null;
  classifiedIntent: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  toolCallsCount: number;
}

export function mapAiAgentRun(r: any): PublicAiAgentRun {
  return {
    id: r.id,
    conversationId: r.conversationId,
    agentId: r.agentId,
    status: r.status,
    finalAction: r.finalAction ?? null,
    modelId: r.modelId,
    inputTokens: r.inputTokens ?? 0,
    outputTokens: r.outputTokens ?? 0,
    costUsd: r.costUsd != null ? Number(r.costUsd) : 0,
    durationMs: r.durationMs ?? null,
    classifiedIntent: r.classifiedIntent ?? null,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt ?? null,
    toolCallsCount: r._count?.toolCalls ?? 0,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/modules/public-api/mappers/ai-agent-run.mapper.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/public-api/mappers/ai-agent-run.mapper.ts src/modules/public-api/mappers/ai-agent-run.mapper.spec.ts
git commit -m "feat(public-api): add ai-agent-run mapper"
```

---

## Task 3: PublicAiAgentsService

**Files:**
- Create: `src/modules/public-api/ai-agents/public-ai-agents.service.ts`
- Test: `src/modules/public-api/ai-agents/public-ai-agents.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// public-ai-agents.service.spec.ts
import { PublicAiAgentsService } from './public-ai-agents.service';

function build() {
  const prisma = {
    aiAgent: {
      findMany: jest.fn().mockResolvedValue([{ id: 'ag1' }]),
      findFirst: jest.fn().mockResolvedValue({ id: 'ag1', organizationId: 'o' }),
    },
    aiAgentRun: { findMany: jest.fn().mockResolvedValue([{ id: 'r1' }]) },
  };
  return { prisma, service: new PublicAiAgentsService(prisma as any) };
}

describe('PublicAiAgentsService', () => {
  it('list escopa por org e exclui deletados', async () => {
    const { prisma, service } = build();
    await service.list('org1');
    const arg = prisma.aiAgent.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ organizationId: 'org1', deletedAt: null });
  });

  it('findOne rejeita agente de outra org (404)', async () => {
    const { prisma, service } = build();
    prisma.aiAgent.findFirst.mockResolvedValue(null);
    await expect(service.findOne('other', 'ag1')).rejects.toThrow();
  });

  it('listRuns valida o agent (findOne) antes e escopa por agentId+org com limit', async () => {
    const { prisma, service } = build();
    const out = await service.listRuns('org1', 'ag1', 10);
    expect(prisma.aiAgent.findFirst).toHaveBeenCalled(); // findOne guard
    const arg = prisma.aiAgentRun.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ agentId: 'ag1', organizationId: 'org1' });
    expect(arg.take).toBe(10);
    expect(arg.orderBy).toEqual({ startedAt: 'desc' });
    expect(out).toEqual([{ id: 'r1' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/modules/public-api/ai-agents/public-ai-agents.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// public-ai-agents.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class PublicAiAgentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string) {
    return this.prisma.aiAgent.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }],
      include: { channels: { include: { channel: { select: { id: true, name: true, type: true } } } } },
    });
  }

  async findOne(organizationId: string, id: string) {
    const agent = await this.prisma.aiAgent.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: { channels: { include: { channel: { select: { id: true, name: true, type: true } } } } },
    });
    if (!agent) throw new NotFoundException('AI agent not found');
    return agent;
  }

  async listRuns(organizationId: string, agentId: string, limit: number) {
    await this.findOne(organizationId, agentId);
    return this.prisma.aiAgentRun.findMany({
      where: { agentId, organizationId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      include: { _count: { select: { toolCalls: true } } },
    });
  }
}
```

> **Nota p/ implementador:** se o typecheck reclamar de `_count: { select: { toolCalls: true } }` no `aiAgentRun`, confirmar o nome da relação com `awk '/^model AiAgentRun \{/,/^\}/' prisma/schema.prisma | grep -i toolcall` (o service interno `agents.service.ts:listRuns` usa `include: { toolCalls: true }`, então a relação se chama `toolCalls` e `_count` deve funcionar). Fallback se necessário: `include: { toolCalls: { select: { id: true } } }` e no mapper usar `r.toolCalls?.length ?? 0` em vez de `r._count?.toolCalls` (ajustar o teste do mapper junto).

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/modules/public-api/ai-agents/public-ai-agents.service.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/public-api/ai-agents/
git commit -m "feat(public-api): add isolated ai-agents read service"
```

---

## Task 4: DTO de runs

**Files:**
- Create: `src/modules/public-api/dto/list-agent-runs.public.dto.ts`

- [ ] **Step 1: Write the DTO**

```ts
// list-agent-runs.public.dto.ts
import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListAgentRunsPublicDto {
  @ApiPropertyOptional({ default: 50, description: 'Quantos runs recentes retornar (max 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `yarn typecheck` (deve passar).

```bash
git add src/modules/public-api/dto/list-agent-runs.public.dto.ts
git commit -m "feat(public-api): add agent-runs limit DTO"
```

---

## Task 5: Controller de AI Agents

**Files:**
- Create: `src/modules/public-api/controllers/public-ai-agents.controller.ts`

- [ ] **Step 1: Write the controller**

```ts
// public-ai-agents.controller.ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../../../common/guards';
import { CurrentOrg } from '../../../common/decorators';
import { ApiKeyThrottleGuard } from '../guards/api-key-throttle.guard';
import { PublicAiAgentsService } from '../ai-agents/public-ai-agents.service';
import { mapAiAgent } from '../mappers/ai-agent.mapper';
import { mapAiAgentRun } from '../mappers/ai-agent-run.mapper';
import { ListAgentRunsPublicDto } from '../dto/list-agent-runs.public.dto';

@ApiTags('Public API · AI Agents')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottleGuard)
@Controller('public/ai-agents')
export class PublicAiAgentsController {
  constructor(private readonly service: PublicAiAgentsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os agentes de IA da organização' })
  async list(@CurrentOrg('id') orgId: string) {
    const agents = await this.service.list(orgId);
    return { items: agents.map(mapAiAgent) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha um agente de IA' })
  async get(@CurrentOrg('id') orgId: string, @Param('id') id: string) {
    return mapAiAgent(await this.service.findOne(orgId, id));
  }

  @Get(':id/runs')
  @ApiOperation({ summary: 'Histórico de execuções do agente (mais recentes)' })
  async runs(@CurrentOrg('id') orgId: string, @Param('id') id: string, @Query() q: ListAgentRunsPublicDto) {
    const runs = await this.service.listRuns(orgId, id, q.limit);
    return { items: runs.map(mapAiAgentRun) };
  }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `yarn typecheck`.

```bash
git add src/modules/public-api/controllers/public-ai-agents.controller.ts
git commit -m "feat(public-api): add ai-agents controller"
```

---

## Task 6: Wire-up do PublicApiModule

**Files:**
- Modify: `src/modules/public-api/public-api.module.ts`

- [ ] **Step 1: Update the module**

READ o arquivo atual. Mantendo TUDO das Fases 1–3, ADICIONAR:
- `import { PublicAiAgentsController } from './controllers/public-ai-agents.controller';`
- `import { PublicAiAgentsService } from './ai-agents/public-ai-agents.service';`
- `PublicAiAgentsController` ao array `controllers`.
- `PublicAiAgentsService` ao array `providers`.

Não remover nada. `PrismaModule` é `@Global` → o service recebe `PrismaService` sem import extra.

- [ ] **Step 2: Build para verificar DI**

Run: `yarn build`
Expected: sucesso.

- [ ] **Step 3: Commit**

```bash
git add src/modules/public-api/public-api.module.ts
git commit -m "feat(public-api): wire up ai-agents controller"
```

---

## Task 7: Suíte completa + verificação

- [ ] **Step 1: Rodar toda a suíte**

Run: `yarn test`
Expected: todos os specs passam (novos: ai-agent/ai-agent-run mappers + public-ai-agents.service; + pré-existentes intactos).

- [ ] **Step 2: Typecheck + build**

Run: `yarn typecheck && yarn build`
Expected: sem erros.

- [ ] **Step 3: Checklist de smoke manual (ambiente com DB + API-key)**

- `GET /public/ai-agents` → `{ items: [...] }` **sem** `systemPrompt`/`operationalContext`/`modelParams` em nenhum item.
- `GET /public/ai-agents/<id>` → agente; id inexistente/de outra org → 404.
- `GET /public/ai-agents/<id>/runs?limit=5` → até 5 runs com `costUsd` numérico e `toolCallsCount`, **sem** o I/O dos toolCalls.
- `/docs/public` → nova tag `Public API · AI Agents`.

- [ ] **Step 4: Commit final (se houver ajustes)**

```bash
git add -A && git commit -m "chore(public-api): finalize phase-4 ai-agents"
```

---

## Notas de execução

- **Aditivo, read-only:** único arquivo existente modificado: `public-api.module.ts` (só adiciona controller/provider).
- **Worktree isolado:** todo o trabalho em `chat-bullq-api-phase4/` (branch `feat/public-api-phase4`, base `feat/public-api-phase3`). Não tocar no checkout principal.
- **Sem migration** (só lê tabelas existentes).
- **`costUsd` Decimal:** o mapper converte com `Number(...)`; o teste usa um mock com `valueOf` pra simular o `Prisma.Decimal`.
- **Smoke em runtime** depende de DB + API-key — fica pro ambiente do usuário.
