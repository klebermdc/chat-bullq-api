# Public API — Fase 3 (Members / Organization / Activity Logs) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor, somente leitura, `GET /public/members` (+`/:id`), `GET /public/organization` e `GET /public/activity-logs` na API pública, reusando `OrganizationsService` e adicionando um `ActivityLogsService` novo.

**Architecture:** Controllers finos `public/*` + mappers allowlist (padrão Fases 1–2), guardados por API-key com escopo por org. Members/Organization reusam `OrganizationsService`; Activity Logs é um service novo que pagina `ConversationAuditLog` com org-scope via join na `Conversation`. **Aditivo, read-only.**

**Tech Stack:** NestJS 11, Prisma 6, Jest (specs colocados com mocks).

**Worktree:** trabalhar em `chat-bullq-api-phase3/` (branch `feat/public-api-phase3`, isolada — NÃO usar o checkout principal `chat-bullq-api/`).

---

## Convenções verificadas (não re-derivar)

- Prefixo global `api/v1` → `@Controller('public/x')` = `api/v1/public/x`.
- Envelope `{ data, meta }` automático via `ResponseInterceptor` — não envelopar à mão.
- Guards: `@UseGuards(ApiKeyAuthGuard, ApiKeyThrottleGuard)` (de `../../common/guards` e `../public-api/guards/api-key-throttle.guard` quando o controller está em `src/modules/public-api/...`), `@ApiSecurity('api-key')`, org de `@CurrentOrg('id')`.
- `toPublicPage(items, total, page, limit)` em `src/modules/public-api/dto/public-page.ts` → `{ items, page, limit, total, hasMore }`.
- `OrganizationsService` (em `src/modules/organizations/`, módulo **exporta** `OrganizationsService`):
  - `getMembers(orgId)` → `UserOrganization[]` com `user { id, name, email, avatarUrl, isActive }` incluído, `orderBy joinedAt asc`. Cada item: `{ id, userId, organizationId, role, agentStatus, maxConcurrent, preferences, joinedAt, user }`.
  - `getOrganization(orgId)` → row de `Organization` (throw `NotFoundException` se não achar).
- `ConversationAuditLog`: `{ id, conversationId, actorId?, action (String), fromValue?, toValue?, metadata (Json), createdAt }`. Relação `conversation` → `Conversation` (que tem `organizationId`). Índice `@@index([conversationId, createdAt])`.
- `PrismaService` em `src/database/prisma.service` (import `../../database/prisma.service` de dentro de `src/modules/public-api/...`).
- Test: `*.spec.ts` colocado, instanciar classe com deps mockadas. Rodar `yarn test <path>`.

---

## Estrutura de arquivos

```
src/modules/public-api/
  public-api.module.ts                       # MODIFICAR: + import OrganizationsModule, + 3 controllers, + ActivityLogsService provider
  mappers/
    member.mapper.ts                         # CRIAR (+ .spec.ts)
    organization.mapper.ts                   # CRIAR (+ .spec.ts)
    activity-log.mapper.ts                   # CRIAR
  dto/
    list-activity-logs.public.dto.ts         # CRIAR
  activity-logs/
    activity-logs.service.ts                 # CRIAR (+ .spec.ts)
  controllers/
    public-members.controller.ts             # CRIAR
    public-organization.controller.ts        # CRIAR
    public-activity-logs.controller.ts       # CRIAR
```

---

## Task 1: Member mapper

**Files:**
- Create: `src/modules/public-api/mappers/member.mapper.ts`
- Test: `src/modules/public-api/mappers/member.mapper.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// member.mapper.spec.ts
import { mapMember } from './member.mapper';

describe('mapMember', () => {
  const raw = {
    id: 'mem1', userId: 'u1', organizationId: 'o', role: 'ADMIN', agentStatus: 'ONLINE',
    maxConcurrent: 5, preferences: { theme: 'dark' }, joinedAt: new Date('2026-01-01'),
    user: { id: 'u1', name: 'Ana', email: 'ana@x.com', avatarUrl: 'http://x/a.png', isActive: true },
  };

  it('expõe membership id + userId e omite internos (preferences, maxConcurrent, organizationId)', () => {
    const out = mapMember(raw as any);
    expect(out).toEqual({
      id: 'mem1', userId: 'u1', name: 'Ana', email: 'ana@x.com', avatarUrl: 'http://x/a.png',
      role: 'ADMIN', agentStatus: 'ONLINE', joinedAt: new Date('2026-01-01'),
    });
    expect((out as any).preferences).toBeUndefined();
    expect((out as any).maxConcurrent).toBeUndefined();
    expect((out as any).organizationId).toBeUndefined();
  });

  it('tolera user ausente', () => {
    const out = mapMember({ id: 'mem2', userId: 'u2', role: 'AGENT', agentStatus: 'OFFLINE', joinedAt: new Date() } as any);
    expect(out.name).toBeNull();
    expect(out.email).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/modules/public-api/mappers/member.mapper.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// member.mapper.ts
export interface PublicMember {
  id: string;
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  agentStatus: string;
  joinedAt: Date;
}

export function mapMember(m: any): PublicMember {
  return {
    id: m.id,
    userId: m.userId ?? m.user?.id,
    name: m.user?.name ?? null,
    email: m.user?.email ?? null,
    avatarUrl: m.user?.avatarUrl ?? null,
    role: m.role,
    agentStatus: m.agentStatus,
    joinedAt: m.joinedAt,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/modules/public-api/mappers/member.mapper.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/public-api/mappers/member.mapper.ts src/modules/public-api/mappers/member.mapper.spec.ts
git commit -m "feat(public-api): add member mapper"
```

---

## Task 2: Organization mapper (allowlist)

**Files:**
- Create: `src/modules/public-api/mappers/organization.mapper.ts`
- Test: `src/modules/public-api/mappers/organization.mapper.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// organization.mapper.spec.ts
import { mapOrganization } from './organization.mapper';

describe('mapOrganization', () => {
  it('expõe só campos públicos e NUNCA vaza settings/config de IA', () => {
    const out = mapOrganization({
      id: 'o1', name: 'Orlando FastPass', slug: 'ofp', logoUrl: 'http://x/l.png', plan: 'pro',
      createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-02-01'), deletedAt: null,
      settings: { secretKey: 'SECRET' }, aiEnabled: true, aiBusinessHours: { mon: '9-18' },
      aiMonthlyTokenCap: 100000, aiOutOfHoursMessage: 'fechado',
    } as any);
    expect(out).toEqual({ id: 'o1', name: 'Orlando FastPass', slug: 'ofp', logoUrl: 'http://x/l.png', plan: 'pro', createdAt: new Date('2026-01-01') });
    expect((out as any).settings).toBeUndefined();
    expect((out as any).aiEnabled).toBeUndefined();
    expect((out as any).aiMonthlyTokenCap).toBeUndefined();
    expect((out as any).updatedAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/modules/public-api/mappers/organization.mapper.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// organization.mapper.ts
export interface PublicOrganization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  plan: string;
  createdAt: Date;
}

// Allowlist: só os campos abaixo saem. settings/config de IA/token caps são
// omitidos por construção (nunca copiados).
export function mapOrganization(o: any): PublicOrganization {
  return {
    id: o.id,
    name: o.name,
    slug: o.slug,
    logoUrl: o.logoUrl ?? null,
    plan: o.plan,
    createdAt: o.createdAt,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/modules/public-api/mappers/organization.mapper.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/public-api/mappers/organization.mapper.ts src/modules/public-api/mappers/organization.mapper.spec.ts
git commit -m "feat(public-api): add organization mapper (allowlist)"
```

---

## Task 3: Activity-log mapper

**Files:**
- Create: `src/modules/public-api/mappers/activity-log.mapper.ts`
- Test: `src/modules/public-api/mappers/activity-log.mapper.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// activity-log.mapper.spec.ts
import { mapActivityLog } from './activity-log.mapper';

describe('mapActivityLog', () => {
  it('expõe campos públicos e omite metadata', () => {
    const out = mapActivityLog({
      id: 'a1', conversationId: 'cv1', actorId: 'u1', action: 'STATUS_CHANGED',
      fromValue: 'OPEN', toValue: 'CLOSED', metadata: { internal: true }, createdAt: new Date('2026-03-01'),
    } as any);
    expect(out).toEqual({
      id: 'a1', conversationId: 'cv1', actorId: 'u1', action: 'STATUS_CHANGED',
      fromValue: 'OPEN', toValue: 'CLOSED', createdAt: new Date('2026-03-01'),
    });
    expect((out as any).metadata).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/modules/public-api/mappers/activity-log.mapper.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// activity-log.mapper.ts
export interface PublicActivityLog {
  id: string;
  conversationId: string;
  actorId: string | null;
  action: string;
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
}

export function mapActivityLog(l: any): PublicActivityLog {
  return {
    id: l.id,
    conversationId: l.conversationId,
    actorId: l.actorId ?? null,
    action: l.action,
    fromValue: l.fromValue ?? null,
    toValue: l.toValue ?? null,
    createdAt: l.createdAt,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/modules/public-api/mappers/activity-log.mapper.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/public-api/mappers/activity-log.mapper.ts src/modules/public-api/mappers/activity-log.mapper.spec.ts
git commit -m "feat(public-api): add activity-log mapper"
```

---

## Task 4: ActivityLogsService

**Files:**
- Create: `src/modules/public-api/activity-logs/activity-logs.service.ts`
- Test: `src/modules/public-api/activity-logs/activity-logs.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// activity-logs.service.spec.ts
import { ActivityLogsService } from './activity-logs.service';

function build() {
  const prisma = {
    conversationAuditLog: {
      findMany: jest.fn().mockResolvedValue([{ id: 'a1' }]),
      count: jest.fn().mockResolvedValue(1),
    },
    $transaction: jest.fn().mockImplementation((arr) => Promise.all(arr)),
  };
  return { prisma, service: new ActivityLogsService(prisma as any) };
}

describe('ActivityLogsService.list', () => {
  it('escopa por org via conversation.organizationId e pagina', async () => {
    const { prisma, service } = build();
    const out = await service.list('org1', {}, 1, 20);
    const arg = prisma.conversationAuditLog.findMany.mock.calls[0][0];
    expect(arg.where.conversation).toEqual({ organizationId: 'org1' });
    expect(arg.skip).toBe(0);
    expect(arg.take).toBe(20);
    expect(arg.orderBy).toEqual({ createdAt: 'desc' });
    expect(out).toEqual({ logs: [{ id: 'a1' }], total: 1 });
  });

  it('aplica filtros conversationId/actorId/action e intervalo de datas', async () => {
    const { prisma, service } = build();
    const from = new Date('2026-01-01');
    const to = new Date('2026-02-01');
    await service.list('org1', { conversationId: 'cv1', actorId: 'u1', action: 'ASSIGNED', from, to }, 2, 10);
    const arg = prisma.conversationAuditLog.findMany.mock.calls[0][0];
    expect(arg.where).toMatchObject({
      conversation: { organizationId: 'org1' },
      conversationId: 'cv1', actorId: 'u1', action: 'ASSIGNED',
      createdAt: { gte: from, lte: to },
    });
    expect(arg.skip).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/modules/public-api/activity-logs/activity-logs.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write implementation**

```ts
// activity-logs.service.ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class ActivityLogsService {
  constructor(private readonly prisma: PrismaService) {}

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
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/modules/public-api/activity-logs/activity-logs.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/public-api/activity-logs/
git commit -m "feat(public-api): add activity-logs query service"
```

---

## Task 5: DTO de filtros de Activity Logs

**Files:**
- Create: `src/modules/public-api/dto/list-activity-logs.public.dto.ts`

- [ ] **Step 1: Write the DTO**

```ts
// list-activity-logs.public.dto.ts
import { IsOptional, IsString, IsInt, IsDateString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListActivityLogsPublicDto {
  @ApiPropertyOptional() @IsOptional() @IsString() conversationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() actorId?: string;
  @ApiPropertyOptional({ description: 'Nome da ação (ex: STATUS_CHANGED)' })
  @IsOptional() @IsString() action?: string;
  @ApiPropertyOptional({ description: 'Data inicial ISO 8601' })
  @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional({ description: 'Data final ISO 8601' })
  @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
}
```

- [ ] **Step 2: Typecheck**

Run: `yarn typecheck`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/modules/public-api/dto/list-activity-logs.public.dto.ts
git commit -m "feat(public-api): add activity-logs filter DTO"
```

---

## Task 6: Controller de Members

**Files:**
- Create: `src/modules/public-api/controllers/public-members.controller.ts`

- [ ] **Step 1: Write the controller**

```ts
// public-members.controller.ts
import { Controller, Get, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../../../common/guards';
import { CurrentOrg } from '../../../common/decorators';
import { ApiKeyThrottleGuard } from '../guards/api-key-throttle.guard';
import { OrganizationsService } from '../../organizations/organizations.service';
import { mapMember } from '../mappers/member.mapper';

@ApiTags('Public API · Members')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottleGuard)
@Controller('public/members')
export class PublicMembersController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista membros da organização' })
  async list(@CurrentOrg('id') orgId: string) {
    const members = await this.organizations.getMembers(orgId);
    return { items: members.map(mapMember) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha um membro (por membership id)' })
  async get(@CurrentOrg('id') orgId: string, @Param('id') id: string) {
    const members = await this.organizations.getMembers(orgId);
    const member = members.find((m: any) => m.id === id);
    if (!member) throw new NotFoundException('Member not found');
    return mapMember(member);
  }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `yarn typecheck` (deve passar).

```bash
git add src/modules/public-api/controllers/public-members.controller.ts
git commit -m "feat(public-api): add members controller"
```

---

## Task 7: Controller de Organization

**Files:**
- Create: `src/modules/public-api/controllers/public-organization.controller.ts`

- [ ] **Step 1: Write the controller**

```ts
// public-organization.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../../../common/guards';
import { CurrentOrg } from '../../../common/decorators';
import { ApiKeyThrottleGuard } from '../guards/api-key-throttle.guard';
import { OrganizationsService } from '../../organizations/organizations.service';
import { mapOrganization } from '../mappers/organization.mapper';

@ApiTags('Public API · Organization')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottleGuard)
@Controller('public/organization')
export class PublicOrganizationController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'Dados da organização da API-key' })
  async get(@CurrentOrg('id') orgId: string) {
    return mapOrganization(await this.organizations.getOrganization(orgId));
  }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `yarn typecheck`.

```bash
git add src/modules/public-api/controllers/public-organization.controller.ts
git commit -m "feat(public-api): add organization controller"
```

---

## Task 8: Controller de Activity Logs

**Files:**
- Create: `src/modules/public-api/controllers/public-activity-logs.controller.ts`

- [ ] **Step 1: Write the controller**

```ts
// public-activity-logs.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../../../common/guards';
import { CurrentOrg } from '../../../common/decorators';
import { ApiKeyThrottleGuard } from '../guards/api-key-throttle.guard';
import { toPublicPage } from '../dto/public-page';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { mapActivityLog } from '../mappers/activity-log.mapper';
import { ListActivityLogsPublicDto } from '../dto/list-activity-logs.public.dto';

@ApiTags('Public API · Activity Logs')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottleGuard)
@Controller('public/activity-logs')
export class PublicActivityLogsController {
  constructor(private readonly service: ActivityLogsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista eventos de auditoria de conversas (paginado)' })
  async list(@CurrentOrg('id') orgId: string, @Query() q: ListActivityLogsPublicDto) {
    const filters = {
      conversationId: q.conversationId,
      actorId: q.actorId,
      action: q.action,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    };
    const { logs, total } = await this.service.list(orgId, filters, q.page, q.limit);
    return toPublicPage(logs.map(mapActivityLog), total, q.page, q.limit);
  }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `yarn typecheck`.

```bash
git add src/modules/public-api/controllers/public-activity-logs.controller.ts
git commit -m "feat(public-api): add activity-logs controller"
```

---

## Task 9: Wire-up do PublicApiModule

**Files:**
- Modify: `src/modules/public-api/public-api.module.ts`

Verificar antes: `OrganizationsModule` exporta `OrganizationsService` (confirmado). Confirmar o caminho de import (`../organizations/organizations.module`).

- [ ] **Step 1: Update the module**

Adicionar ao `public-api.module.ts` (mantendo tudo que já existe das Fases 1–2):
- import: `import { OrganizationsModule } from '../organizations/organizations.module';`
- import: `import { ActivityLogsService } from './activity-logs/activity-logs.service';`
- imports dos 3 controllers novos.
- `imports: [...existentes, OrganizationsModule]`
- `controllers: [...existentes, PublicMembersController, PublicOrganizationController, PublicActivityLogsController]`
- `providers: [...existentes, ActivityLogsService]`

```ts
import { PublicMembersController } from './controllers/public-members.controller';
import { PublicOrganizationController } from './controllers/public-organization.controller';
import { PublicActivityLogsController } from './controllers/public-activity-logs.controller';
import { ActivityLogsService } from './activity-logs/activity-logs.service';
import { OrganizationsModule } from '../organizations/organizations.module';
// no @Module:
//   imports: [ ...existentes, OrganizationsModule ],
//   controllers: [ ...existentes, PublicMembersController, PublicOrganizationController, PublicActivityLogsController ],
//   providers: [ ...existentes, ActivityLogsService ],
```

> `ActivityLogsService` injeta `PrismaService`. Se o `PublicApiModule` não tiver o Prisma disponível, importar `PrismaModule` (de `src/database/prisma.module`) nos imports. Conferir se já está (as Fases 1–2 usam Prisma indiretamente via serviços importados; o `ActivityLogsService` é o primeiro provider LOCAL que injeta Prisma direto — então **provavelmente precisa** adicionar `PrismaModule` aos imports). Verificar `PrismaModule` é `@Global()` — se for, não precisa importar.

- [ ] **Step 2: Build para verificar DI**

Run: `yarn build`
Expected: sucesso. Se DI falhar por `PrismaService` não resolvido no `ActivityLogsService`, adicionar `PrismaModule` aos imports do `PublicApiModule` e rebuildar.

- [ ] **Step 3: Commit**

```bash
git add src/modules/public-api/public-api.module.ts
git commit -m "feat(public-api): wire up phase-3 members/org/activity-logs controllers"
```

---

## Task 10: Suíte completa + verificação

- [ ] **Step 1: Rodar toda a suíte**

Run: `yarn test`
Expected: todos os specs passam (novos: member/organization/activity-log mappers + activity-logs.service; + pré-existentes intactos).

- [ ] **Step 2: Typecheck + build**

Run: `yarn typecheck && yarn build`
Expected: sem erros.

- [ ] **Step 3: Checklist de smoke manual (ambiente com DB + API-key)**

- `GET /public/members` → `{ items: [...] }` com membros mapeados (sem `preferences`/`maxConcurrent`).
- `GET /public/members/<membershipId>` → membro; id inexistente → 404.
- `GET /public/organization` → dados da org **sem** `settings`/config de IA.
- `GET /public/activity-logs?limit=5` → página `{ items, page, limit, total, hasMore }`.
- `GET /public/activity-logs?conversationId=<id>&from=2026-01-01` → filtra.
- `/docs/public` → novas tags Members/Organization/Activity Logs aparecem.

- [ ] **Step 4: Commit final (se houver ajustes)**

```bash
git add -A && git commit -m "chore(public-api): finalize phase-3"
```

---

## Notas de execução

- **Aditivo, read-only:** nada existente muda de comportamento. Único arquivo existente modificado: `public-api.module.ts` (só adiciona imports/controllers/provider).
- **Worktree isolado:** todo o trabalho em `chat-bullq-api-phase3/` (branch `feat/public-api-phase3`). Não tocar no checkout principal `chat-bullq-api/` (o usuário trabalha nele ao vivo).
- **Migration:** Fase 3 NÃO tem migration (só leitura de tabelas existentes).
- **Smoke em runtime** depende de DB + API-key — fica pro ambiente do usuário.
