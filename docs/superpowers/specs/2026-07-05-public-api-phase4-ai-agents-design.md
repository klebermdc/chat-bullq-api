# Public API — Fase 4: AI Agents (read-only) (Design)

**Data:** 2026-07-05
**Status:** Aprovado para implementação
**Escopo:** Fase 4 da API pública. Depende das Fases 1–3 (branch base `feat/public-api-phase3`).

---

## 1. Objetivo

Expor, **somente leitura**, os agentes de IA da organização na API pública:
- **Roster:** `GET /public/ai-agents` (lista), `GET /public/ai-agents/:id` (detalhe).
- **Runs:** `GET /public/ai-agents/:id/runs` (histórico de execução com tokens/custo/status).

O sistema de IA do Chat BullQ é próprio e muito mais rico que o da Umbler
(organograma matricial, RAG, tools, skills) — **não** replicamos a API da Umbler
(sem "voices"/"pre-trained sectors"). Fase 4 expõe **os nossos** agentes, com
schema próprio e **allowlist** protegendo a PI do negócio.

---

## 2. Princípios

- **Aditivo, read-only.** Só adiciona controllers/mappers/DTO e um service novo.
  Nenhum endpoint/serviço existente muda.
- **Isolamento:** service de leitura próprio (`PublicAiAgentsService`) que injeta
  só `PrismaService` — **NÃO** importa o `AiAgentsModule` (pesado: RAG, LLM, filas
  BullMQ). Mesmo padrão do `ActivityLogsService` (Fase 3).
- **Segurança por allowlist:** os mappers expõem só campos seguros e **nunca**
  vazam `systemPrompt`, `operationalContext`, `modelParams`, nem o I/O dos
  `toolCalls`.
- Padrão Fases 1–3: `@UseGuards(ApiKeyAuthGuard, ApiKeyThrottleGuard)`,
  `@ApiSecurity('api-key')`, org de `@CurrentOrg('id')`.

---

## 3. Endpoints

| Método + rota | Fonte |
|---|---|
| `GET /public/ai-agents` | `PublicAiAgentsService.list(orgId)` → `{ items }` |
| `GET /public/ai-agents/:id` | `PublicAiAgentsService.findOne(orgId, id)` (404 se não achar) |
| `GET /public/ai-agents/:id/runs?limit=` | `PublicAiAgentsService.listRuns(orgId, id, limit)` → `{ items }` |

`GET /:id/runs` aceita `limit` (default 50, max 100). Sem paginação por
página nesta fase (lista os N mais recentes) — igual ao `listRuns` interno.

---

## 4. Código novo: `PublicAiAgentsService`

Local: `src/modules/public-api/ai-agents/public-ai-agents.service.ts` (provider do
`PublicApiModule`; injeta `PrismaService`). Espelha as queries internas:

```ts
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
  await this.findOne(organizationId, agentId); // garante que o agent é da org (404 senão)
  return this.prisma.aiAgentRun.findMany({
    where: { agentId, organizationId },
    orderBy: { startedAt: 'desc' },
    take: limit,
    include: { _count: { select: { toolCalls: true } } },
  });
}
```

> `listRuns` usa `_count.toolCalls` em vez de `include: { toolCalls: true }` (o
> mapper só expõe a contagem, não o I/O). Org-scope duplo: `findOne` valida o
> agent, e o `where` do run tem `agentId` + `organizationId`.

---

## 5. Mappers (allowlist — segurança)

**`ai-agent.mapper.ts`** — de `AiAgent`:
```
{ id, name, description, avatarUrl, kind, category, department, squad,
  parentAgentId, capabilities, isActive, canRespondDirectly, modelId, createdAt,
  channels: [{ id, name, type }] }
```
**OMITE** (nunca copiados): `systemPrompt`, `operationalContext`,
`operationalContextUpdatedAt`, `modelParams`, `temperature`, `maxTokens`,
`followUpCadenceHours`, `organizationId`, `deletedAt`. Allowlist por construção.

**`ai-agent-run.mapper.ts`** — de `AiAgentRun`:
```
{ id, conversationId, agentId, status, finalAction, modelId,
  inputTokens, outputTokens, costUsd, durationMs, classifiedIntent,
  startedAt, finishedAt, toolCallsCount }
```
`toolCallsCount` = `run._count?.toolCalls ?? 0`. `costUsd` é `Decimal` no Prisma —
o mapper converte para `Number` (ou string) para serializar como JSON limpo.
**OMITE** o conteúdo dos `toolCalls`, `errorMessage` interno, `triggerMessageId`,
`classifierConfidence`, `organizationId`.

---

## 6. Controllers + DTO

- `public-ai-agents.controller.ts` (`@Controller('public/ai-agents')`):
  - `GET /` → `list` → `{ items: agents.map(mapAiAgent) }`
  - `GET /:id` → `findOne` → `mapAiAgent(...)`
  - `GET /:id/runs` → `listRuns(orgId, id, limit)` → `{ items: runs.map(mapAiAgentRun) }`
- `dto/list-agent-runs.public.dto.ts` — valida `limit` (`@Type(() => Number) @IsInt() @Min(1) @Max(100)`, default 50).

## 7. Módulo

`PublicApiModule` registra `PublicAiAgentsController` (controllers) e
`PublicAiAgentsService` (providers). `PrismaModule` é `@Global` → sem import extra.
Entra no `/docs/public` com tag `Public API · AI Agents`.

## 8. Testes

- **Unit:** `ai-agent.mapper` (allowlist — feed com `systemPrompt`/`operationalContext`/`modelParams` e assert que somem), `ai-agent-run.mapper` (converte `costUsd` Decimal→number, `toolCallsCount` de `_count`, omite toolCalls I/O), e `PublicAiAgentsService` (org-scope: `where` inclui `organizationId` + `deletedAt: null`; `listRuns` chama `findOne` primeiro; `limit` respeitado) com prisma mockado.
- Padrão Jest existente. `yarn test`.

## 9. Fora de escopo

- Criar/editar/deletar agentes via API (Fase 4 é read-only).
- Knowledge bases / RAG, tools, skills, evals, confirmations (fora — domínio interno complexo).
- Expor `systemPrompt`/`operationalContext`/`toolCalls` (decisão explícita de segurança).
- Paginação por página em runs (usa `limit` dos N mais recentes).

## 10. Riscos / a resolver no plano

1. `costUsd` é `Prisma.Decimal` — o mapper deve convertê-lo (`Number(run.costUsd)` ou `.toString()`); confirmar no plano e testar (não serializar o objeto Decimal cru).
2. `_count.toolCalls` — confirmar que o Prisma aceita `include: { _count: { select: { toolCalls: true } } }` no `aiAgentRun` (a relação `toolCalls` existe em `AiAgentRun`). Se não, usar `include: { toolCalls: { select: { id: true } } }` e mapear `.length`.
3. Allowlist: confirmar no plano que nenhum campo novo/sensível do model `AiAgent` vaza — o mapper por allowlist protege por construção.
