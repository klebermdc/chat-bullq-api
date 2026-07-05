# Public API — Fase 3: Members, Organization e Activity Logs (Design)

**Data:** 2026-07-05
**Status:** Aprovado para implementação
**Escopo:** Fase 3 da API pública "estilo Umbler Talk". Depende das Fases 1 e 2.

---

## 1. Objetivo

Expor, **somente leitura**, três recursos organizacionais na API pública:
- **Members** — membros da organização.
- **Organization** — dados da organização à qual a API-key pertence.
- **Activity Logs** — auditoria de eventos de conversa (`ConversationAuditLog`).

Members e Organization **reusam serviços existentes**; Activity Logs é o único
com código novo (não havia endpoint de leitura sobre `ConversationAuditLog`).

---

## 2. Princípios

- **Aditivo, read-only.** Só adiciona controllers/mappers/DTOs e um service novo
  (`ActivityLogsService`). Nenhum endpoint/serviço existente muda.
- **Padrão das Fases 1–2:** controllers finos `public/*` + camada de mapper
  (allowlist), `@UseGuards(ApiKeyAuthGuard, ApiKeyThrottleGuard)`,
  `@ApiSecurity('api-key')`, escopo por org via `@CurrentOrg('id')`.
- **Paginação pública padronizada** `{ items, page, limit, total, hasMore }` via
  `toPublicPage` (Fase 1).

---

## 3. Endpoints

| Método + rota | Fonte | Notas |
|---|---|---|
| `GET /public/members` | `OrganizationsService.getMembers(orgId)` | lista membros |
| `GET /public/members/:id` | `getMembers(orgId)` filtrado por membership id | 404 se não achar |
| `GET /public/organization` | `OrganizationsService.getOrganization(orgId)` | org da chave (singular) |
| `GET /public/activity-logs` | `ActivityLogsService.list(orgId, filters, page, limit)` | paginado; filtros abaixo |

`getMembers` retorna `UserOrganization[]` com `user { id, name, email, avatarUrl,
isActive }` incluído (verificado em `organizations.repository.ts:findMembers`).
`getOrganization` retorna a row de `Organization` (via `findById`).

**Filtros de `/public/activity-logs`** (todos opcionais, query):
`conversationId`, `actorId`, `action`, `from` (ISO date), `to` (ISO date),
`page` (default 1), `limit` (default 20, max 100).

---

## 4. Mappers (allowlist — escondem campos internos)

**`member.mapper.ts`** — de `UserOrganization` + `user`:
```
{ id: membership.id, userId: user.id, name, email, avatarUrl, role, agentStatus, joinedAt }
```
(omite `preferences`, `maxConcurrent`, `isActive` interno, etc.)

**`organization.mapper.ts`** — de `Organization`:
```
{ id, name, slug, logoUrl, plan, createdAt }
```
**Omite** `settings`, todas as flags/config de IA (`aiEnabled`, `aiBusinessHours`,
`aiMonthlyTokenCap`, `aiOutOfHoursMessage`, notas de negócio…), `deletedAt`. É um
allowlist: só os 6 campos acima saem.

**`activity-log.mapper.ts`** — de `ConversationAuditLog`:
```
{ id, conversationId, actorId, action, fromValue, toValue, createdAt }
```
(omite `metadata` — pode conter contexto interno; se quiser expor depois, filtra
por chaves conhecidas.)

---

## 5. Código novo: `ActivityLogsService`

Local: `src/modules/public-api/activity-logs/activity-logs.service.ts` (provider
do `PublicApiModule`; injeta `PrismaService`).

O `ConversationAuditLog` só tem `conversationId` (não `organizationId`), então o
escopo por org vem via join na `Conversation`:

```ts
async list(
  organizationId: string,
  filters: { conversationId?: string; actorId?: string; action?: string; from?: Date; to?: Date },
  page: number,
  limit: number,
) {
  const where: Prisma.ConversationAuditLogWhereInput = {
    conversation: { organizationId },
    ...(filters.conversationId ? { conversationId: filters.conversationId } : {}),
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    ...(filters.from || filters.to
      ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
  };
  const skip = (page - 1) * limit;
  const [logs, total] = await this.prisma.$transaction([
    this.prisma.conversationAuditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    this.prisma.conversationAuditLog.count({ where }),
  ]);
  return { logs, total };
}
```

> Índice: `ConversationAuditLog` tem `@@index([conversationId, createdAt])`. O
> filtro por `conversation.organizationId` usa join — para volumes grandes,
> considerar (débito, não bloqueia) desnormalizar `organizationId` no audit log
> ou um índice dedicado. Aceitável na Fase 3.

---

## 6. Controllers + DTO

- `public-members.controller.ts` (`GET /public/members`, `GET /public/members/:id`).
- `public-organization.controller.ts` (`GET /public/organization`).
- `public-activity-logs.controller.ts` (`GET /public/activity-logs`, usa
  `ListActivityLogsPublicDto`).
- `dto/list-activity-logs.public.dto.ts` — valida os filtros (datas `@IsDateString`,
  `page`/`limit` como na Fase 1) e converte `from`/`to` para `Date`.

`GET /public/members/:id`: chama `getMembers(orgId)`, acha por `m.id === id`
(membership id), 404 (`NotFoundException`) se não existir. Sem query nova.

---

## 7. Módulo

- `PublicApiModule` importa `OrganizationsModule` (que já exporta
  `OrganizationsService`) e registra os 3 controllers novos + `ActivityLogsService`
  como provider. `PrismaService`/`PrismaModule` já disponível no módulo.
- Sem novo módulo dedicado — mantém o padrão da Fase 1 (controllers públicos no
  `PublicApiModule`).

## 8. Swagger

Os 3 controllers entram no `/docs/public` existente, com tags
`Public API · Members`, `Public API · Organization`, `Public API · Activity Logs`.

## 9. Testes

- **Unit:** `member.mapper` (expõe membership id + userId, omite internos),
  `organization.mapper` (allowlist — nunca vaza `settings`/config de IA),
  `activity-log.mapper`, e `ActivityLogsService.list` (monta o `where` com
  org-scope via `conversation.organizationId` + filtros; paginação) com prisma
  mockado.
- Padrão Jest existente (specs colocados, `yarn test`).

## 10. Fora de escopo

- Escrita (criar/editar/remover) de qualquer recurso — Fase 3 é read-only.
- Tags, Quick Replies, Departments (o usuário optou por não incluir nesta fase).
- Página no Admin para Activity Logs (fica pra depois).
- Desnormalizar `organizationId` no audit log (débito registrado em §5).

## 11. Riscos / a resolver no plano

1. Confirmar o shape exato de `getMembers` no plano (campos do `user` incluído já
   verificados: `id, name, email, avatarUrl, isActive`).
2. `getOrganization` retorna a row completa — o `organization.mapper` faz allowlist;
   garantir que nenhum campo sensível novo do model vaze (mapper por allowlist já
   protege por construção).
3. Nome do id em `/public/members/:id`: usar o **membership id** (`userOrganization.id`),
   coerente com o resto do app (ver `findMembership`).
