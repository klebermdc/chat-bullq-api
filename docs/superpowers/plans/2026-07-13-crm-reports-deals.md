# Relatórios do CRM — Fatia 1 (Deals/Funil) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página `/relatorios` (fonte Deals/Funil) com filtros, métricas, tabela paginada e export CSV, respeitando RBAC (agente vê só os dele).

**Architecture:** Backend novo módulo `crm-reports` (NestJS) com endpoints de agregação/listagem/export sobre a tabela `Card`, sem migração. Frontend nova feature `crm-reports` com página + seletor de fonte + FilterBar + MetricsRow + ReportTable + ExportButton.

**Tech Stack:** NestJS + Prisma (api), Next.js + React Query + Tailwind (web). Jest (testes api).

---

## Contexto de padrões (ler antes)

- Controller de referência: `chat-bullq-api/src/modules/sales-reports/sales-reports.controller.ts` (guards `JwtAuthGuard, OrgGuard, RolesGuard`; decorators `@CurrentOrg('id')`, `@CurrentUser('id')`, `@CurrentUserRole()`, `@Query() dto`).
- Spec de referência: `chat-bullq-api/src/modules/sales-reports/sales-reports.service.spec.ts` (`Test.createTestingModule` com `PrismaService` mockado).
- `PrismaService` vem do `PrismaModule` (`@Global`) — não precisa importar no módulo.
- Enum `CardStatus` = `OPEN | WON | LOST` (`@prisma/client`).
- Web service de referência: `chat-bullq-web/src/features/reports/services/sales-reports.service.ts`.
- Nav: `chat-bullq-web/src/components/layout/app-sidebar.tsx` (array de itens ~linha 51).

---

## BACKEND (chat-bullq-api)

### Task 1: Scaffold do módulo crm-reports

**Files:**
- Create: `src/modules/crm-reports/crm-reports.module.ts`
- Create: `src/modules/crm-reports/crm-reports.service.ts`
- Create: `src/modules/crm-reports/crm-reports.controller.ts`
- Create: `src/modules/crm-reports/dto/deals-query.dto.ts`
- Create: `src/modules/crm-reports/crm-reports.types.ts`
- Modify: `src/app.module.ts` (registrar `CrmReportsModule`)

- [ ] **Step 1: Criar os tipos**

`src/modules/crm-reports/crm-reports.types.ts`:
```ts
import { CardStatus } from '@prisma/client';

export interface DealsReportParams {
  orgId: string;
  role: string; // OrgRole
  userId: string;
  pipelineId?: string;
  stageIds?: string[];
  status?: CardStatus;
  assignedToId?: string;
  valueMin?: number;
  valueMax?: number;
  hasProposal?: boolean;
  from?: Date;
  to?: Date;
  dateField?: 'createdAt' | 'closedAt';
  page?: number;
  perPage?: number;
}

export interface DealRow {
  id: string;
  contactName: string | null;
  pipelineName: string;
  stageName: string;
  status: CardStatus;
  value: number | null;
  assignedToName: string | null;
  createdAt: string;
  closedAt: string | null;
  closedReason: string | null;
}

export interface DealsMetrics {
  count: number;
  totalValue: number;
  won: { count: number; value: number };
  lost: { count: number; value: number };
  conversionRate: number; // 0..1
  avgWonTicket: number;
}

export interface DealsReportResult {
  metrics: DealsMetrics;
  rows: DealRow[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
}
```

- [ ] **Step 2: Criar o DTO**

`src/modules/crm-reports/dto/deals-query.dto.ts`:
```ts
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// Query vem como string (querystring). O service converte/valida os tipos.
export class DealsQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() pipelineId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() stageIds?: string; // csv
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;   // OPEN|WON|LOST
  @ApiPropertyOptional() @IsOptional() @IsString() assignedToId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() valueMin?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() valueMax?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() hasProposal?: string; // 'true'|'false'
  @ApiPropertyOptional() @IsOptional() @IsString() from?: string; // ISO
  @ApiPropertyOptional() @IsOptional() @IsString() to?: string;   // ISO
  @ApiPropertyOptional() @IsOptional() @IsString() dateField?: string; // createdAt|closedAt
  @ApiPropertyOptional() @IsOptional() @IsString() page?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() perPage?: string;
}
```

- [ ] **Step 3: Criar service vazio (compila)**

`src/modules/crm-reports/crm-reports.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { Prisma, CardStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { DealsReportParams, DealsReportResult, DealRow } from './crm-reports.types';

@Injectable()
export class CrmReportsService {
  constructor(private readonly prisma: PrismaService) {}

  // Monta o WHERE dos deals a partir dos filtros + RBAC.
  buildDealsWhere(p: DealsReportParams): Prisma.CardWhereInput {
    const where: Prisma.CardWhereInput = { organizationId: p.orgId };
    if (p.pipelineId) where.pipelineId = p.pipelineId;
    if (p.stageIds?.length) where.stageId = { in: p.stageIds };
    if (p.status) where.status = p.status;
    if (p.assignedToId) where.assignedToId = p.assignedToId;
    if (p.valueMin != null || p.valueMax != null) {
      where.value = {};
      if (p.valueMin != null) (where.value as Prisma.DecimalFilter).gte = p.valueMin;
      if (p.valueMax != null) (where.value as Prisma.DecimalFilter).lte = p.valueMax;
    }
    if (p.hasProposal === true) where.contact = { is: { proposals: { some: {} } } };
    if (p.hasProposal === false) where.contact = { is: { proposals: { none: {} } } };
    const dateField = p.dateField === 'closedAt' ? 'closedAt' : 'createdAt';
    if (p.from || p.to) {
      where[dateField] = {};
      if (p.from) (where[dateField] as Prisma.DateTimeFilter).gte = p.from;
      if (p.to) (where[dateField] as Prisma.DateTimeFilter).lte = p.to;
    }
    // RBAC: AGENT só vê deals dele (card OU conversa atribuída a ele).
    if (p.role === 'AGENT') {
      where.OR = [
        { assignedToId: p.userId },
        { conversation: { is: { assignedToId: p.userId } } },
      ];
    }
    return where;
  }

  async getDealsReport(p: DealsReportParams): Promise<DealsReportResult> {
    throw new Error('not implemented');
  }
}
```

- [ ] **Step 4: Criar controller**

`src/modules/crm-reports/crm-reports.controller.ts`:
```ts
import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser, CurrentUserRole } from '../../common/decorators';
import { CrmReportsService } from './crm-reports.service';
import { DealsQueryDto } from './dto/deals-query.dto';
import { parseDealsParams, dealsRowsToCsv } from './crm-reports.mapper';

@ApiTags('crm-reports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('crm-reports')
export class CrmReportsController {
  constructor(private readonly service: CrmReportsService) {}

  @Get('deals')
  getDeals(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query() q: DealsQueryDto,
  ) {
    return this.service.getDealsReport(parseDealsParams(q, orgId, userId, role));
  }

  @Get('deals/export.csv')
  async exportDeals(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query() q: DealsQueryDto,
    @Res() res: Response,
  ) {
    const params = parseDealsParams(q, orgId, userId, role);
    const report = await this.service.getDealsReport({ ...params, page: 1, perPage: 10000 });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="relatorio-deals.csv"');
    res.send(dealsRowsToCsv(report.rows));
  }
}
```

- [ ] **Step 5: Criar o mapper (parse de query + CSV)**

`src/modules/crm-reports/crm-reports.mapper.ts`:
```ts
import { CardStatus, OrgRole } from '@prisma/client';
import { DealsQueryDto } from './dto/deals-query.dto';
import { DealsReportParams, DealRow } from './crm-reports.types';

const toNum = (v?: string) => (v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
const toDate = (v?: string) => (v ? new Date(v) : undefined);

export function parseDealsParams(q: DealsQueryDto, orgId: string, userId: string, role: OrgRole): DealsReportParams {
  const status = q.status && ['OPEN', 'WON', 'LOST'].includes(q.status) ? (q.status as CardStatus) : undefined;
  return {
    orgId, userId, role,
    pipelineId: q.pipelineId || undefined,
    stageIds: q.stageIds ? q.stageIds.split(',').filter(Boolean) : undefined,
    status,
    assignedToId: q.assignedToId || undefined,
    valueMin: toNum(q.valueMin),
    valueMax: toNum(q.valueMax),
    hasProposal: q.hasProposal === 'true' ? true : q.hasProposal === 'false' ? false : undefined,
    from: toDate(q.from),
    to: toDate(q.to),
    dateField: q.dateField === 'closedAt' ? 'closedAt' : 'createdAt',
    page: toNum(q.page) ?? 1,
    perPage: Math.min(toNum(q.perPage) ?? 25, 10000),
  };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function dealsRowsToCsv(rows: DealRow[]): string {
  const header = ['Cliente', 'Pipeline', 'Etapa', 'Status', 'Valor', 'Atendente', 'Criado', 'Fechado', 'Motivo'];
  const lines = rows.map((r) =>
    [r.contactName, r.pipelineName, r.stageName, r.status, r.value ?? '', r.assignedToName, r.createdAt, r.closedAt ?? '', r.closedReason ?? '']
      .map(csvCell).join(','),
  );
  return [header.join(','), ...lines].join('\n');
}
```

- [ ] **Step 6: Criar o módulo e registrar**

`src/modules/crm-reports/crm-reports.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { CrmReportsController } from './crm-reports.controller';
import { CrmReportsService } from './crm-reports.service';

@Module({
  controllers: [CrmReportsController],
  providers: [CrmReportsService],
})
export class CrmReportsModule {}
```

Em `src/app.module.ts`: importar `CrmReportsModule` e adicioná-lo ao array `imports` do `@Module` (seguir a ordem/estilo dos outros módulos já listados).

- [ ] **Step 7: Compilar**

Run: `cd chat-bullq-api && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0 (o service lança em runtime, mas compila).

- [ ] **Step 8: Commit**

```bash
git add src/modules/crm-reports src/app.module.ts
git commit -m "feat(crm-reports): scaffold do módulo (deals) + rota registrada"
```

---

### Task 2: getDealsReport — métricas (TDD)

**Files:**
- Test: `src/modules/crm-reports/crm-reports.service.spec.ts`
- Modify: `src/modules/crm-reports/crm-reports.service.ts`

- [ ] **Step 1: Escrever o teste que falha**

`src/modules/crm-reports/crm-reports.service.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { OrgRole, CardStatus } from '@prisma/client';
import { CrmReportsService } from './crm-reports.service';
import { PrismaService } from '../../database/prisma.service';

function makePrisma(overrides: any = {}) {
  return {
    card: {
      groupBy: jest.fn().mockResolvedValue([
        { status: 'WON', _count: { _all: 3 }, _sum: { value: 300 } },
        { status: 'LOST', _count: { _all: 1 }, _sum: { value: 50 } },
        { status: 'OPEN', _count: { _all: 2 }, _sum: { value: 200 } },
      ]),
      count: jest.fn().mockResolvedValue(6),
      findMany: jest.fn().mockResolvedValue([]),
      ...overrides.card,
    },
  } as any;
}

describe('CrmReportsService.getDealsReport (metrics)', () => {
  async function build(prisma: any) {
    const mod = await Test.createTestingModule({
      providers: [CrmReportsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    return mod.get(CrmReportsService);
  }

  it('computa métricas de conversão e totais', async () => {
    const service = await build(makePrisma());
    const r = await service.getDealsReport({ orgId: 'o1', role: OrgRole.ADMIN, userId: 'u1' } as any);
    expect(r.metrics.count).toBe(6);
    expect(r.metrics.totalValue).toBe(550);
    expect(r.metrics.won).toEqual({ count: 3, value: 300 });
    expect(r.metrics.lost).toEqual({ count: 1, value: 50 });
    expect(r.metrics.conversionRate).toBeCloseTo(0.75); // 3 / (3+1)
    expect(r.metrics.avgWonTicket).toBe(100); // 300/3
  });

  it('AGENT restringe o WHERE aos deals dele', async () => {
    const prisma = makePrisma();
    const service = await build(prisma);
    await service.getDealsReport({ orgId: 'o1', role: OrgRole.AGENT, userId: 'u9' } as any);
    const whereArg = prisma.card.groupBy.mock.calls[0][0].where;
    expect(whereArg.OR).toEqual([
      { assignedToId: 'u9' },
      { conversation: { is: { assignedToId: 'u9' } } },
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd chat-bullq-api && npx jest src/modules/crm-reports --silent`
Expected: FAIL (`not implemented`).

- [ ] **Step 3: Implementar getDealsReport (métricas + rows básicos)**

Substituir o corpo de `getDealsReport` em `crm-reports.service.ts`:
```ts
  async getDealsReport(p: DealsReportParams): Promise<DealsReportResult> {
    const where = this.buildDealsWhere(p);
    const page = p.page ?? 1;
    const perPage = p.perPage ?? 25;

    const [grouped, total, cards] = await Promise.all([
      this.prisma.card.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { value: true } }),
      this.prisma.card.count({ where }),
      this.prisma.card.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          contact: { select: { name: true, phone: true } },
          assignedTo: { select: { name: true } },
          conversation: { select: { assignedTo: { select: { name: true } } } },
          stage: { select: { name: true } },
          pipeline: { select: { name: true } },
        },
      }),
    ]);

    const byStatus = (s: CardStatus) => grouped.find((g) => g.status === s);
    const num = (v: unknown) => (v == null ? 0 : Number(v));
    const won = { count: byStatus(CardStatus.WON)?._count._all ?? 0, value: num(byStatus(CardStatus.WON)?._sum.value) };
    const lost = { count: byStatus(CardStatus.LOST)?._count._all ?? 0, value: num(byStatus(CardStatus.LOST)?._sum.value) };
    const totalValue = grouped.reduce((acc, g) => acc + num(g._sum.value), 0);
    const closed = won.count + lost.count;

    const rows: DealRow[] = cards.map((c) => ({
      id: c.id,
      contactName: c.contact?.name ?? c.contact?.phone ?? null,
      pipelineName: c.pipeline?.name ?? '',
      stageName: c.stage?.name ?? '',
      status: c.status,
      value: c.value == null ? null : Number(c.value),
      assignedToName: c.conversation?.assignedTo?.name ?? c.assignedTo?.name ?? null,
      createdAt: c.createdAt.toISOString(),
      closedAt: c.closedAt ? c.closedAt.toISOString() : null,
      closedReason: c.closedReason ?? null,
    }));

    return {
      metrics: {
        count: total,
        totalValue,
        won,
        lost,
        conversionRate: closed > 0 ? won.count / closed : 0,
        avgWonTicket: won.count > 0 ? won.value / won.count : 0,
      },
      rows,
      page,
      perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
    };
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd chat-bullq-api && npx jest src/modules/crm-reports --silent`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/crm-reports
git commit -m "feat(crm-reports): getDealsReport com métricas + RBAC (TDD)"
```

---

### Task 3: Filtros no WHERE (TDD)

**Files:**
- Test: `src/modules/crm-reports/crm-reports.where.spec.ts`
- (usa `buildDealsWhere` já existente)

- [ ] **Step 1: Escrever teste**

`src/modules/crm-reports/crm-reports.where.spec.ts`:
```ts
import { Test } from '@nestjs/testing';
import { OrgRole, CardStatus } from '@prisma/client';
import { CrmReportsService } from './crm-reports.service';
import { PrismaService } from '../../database/prisma.service';

describe('buildDealsWhere', () => {
  let service: CrmReportsService;
  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [CrmReportsService, { provide: PrismaService, useValue: {} }],
    }).compile();
    service = mod.get(CrmReportsService);
  });

  it('aplica pipeline, status, faixa de valor e período', () => {
    const from = new Date('2026-07-01'); const to = new Date('2026-07-31');
    const w: any = service.buildDealsWhere({
      orgId: 'o1', role: OrgRole.ADMIN, userId: 'u1',
      pipelineId: 'p1', status: CardStatus.WON, valueMin: 100, valueMax: 500,
      from, to, dateField: 'createdAt',
    } as any);
    expect(w.organizationId).toBe('o1');
    expect(w.pipelineId).toBe('p1');
    expect(w.status).toBe('WON');
    expect(w.value).toEqual({ gte: 100, lte: 500 });
    expect(w.createdAt).toEqual({ gte: from, lte: to });
    expect(w.OR).toBeUndefined(); // ADMIN não restringe dono
  });

  it('hasProposal=true filtra contatos com proposta', () => {
    const w: any = service.buildDealsWhere({ orgId: 'o1', role: OrgRole.ADMIN, userId: 'u1', hasProposal: true } as any);
    expect(w.contact).toEqual({ is: { proposals: { some: {} } } });
  });

  it('dateField=closedAt filtra pela data de fechamento', () => {
    const to = new Date('2026-07-31');
    const w: any = service.buildDealsWhere({ orgId: 'o1', role: OrgRole.ADMIN, userId: 'u1', to, dateField: 'closedAt' } as any);
    expect(w.closedAt).toEqual({ lte: to });
  });
});
```

- [ ] **Step 2: Rodar e ver passar** (a lógica já existe no Step 3 da Task 1)

Run: `cd chat-bullq-api && npx jest src/modules/crm-reports --silent`
Expected: PASS (todos).

- [ ] **Step 3: Commit**

```bash
git add src/modules/crm-reports
git commit -m "test(crm-reports): cobre filtros do buildDealsWhere"
```

---

### Task 4: CSV mapper (TDD)

**Files:**
- Test: `src/modules/crm-reports/crm-reports.mapper.spec.ts`

- [ ] **Step 1: Escrever teste**

`src/modules/crm-reports/crm-reports.mapper.spec.ts`:
```ts
import { dealsRowsToCsv } from './crm-reports.mapper';
import { CardStatus } from '@prisma/client';

describe('dealsRowsToCsv', () => {
  it('gera header + escapa vírgulas/aspas', () => {
    const csv = dealsRowsToCsv([
      { id: '1', contactName: 'Ana, Maria', pipelineName: 'Vendas', stageName: 'Proposta',
        status: CardStatus.WON, value: 1500, assignedToName: 'Pedro',
        createdAt: '2026-07-01T00:00:00.000Z', closedAt: null, closedReason: 'disse "sim"' },
    ]);
    const [header, row] = csv.split('\n');
    expect(header).toBe('Cliente,Pipeline,Etapa,Status,Valor,Atendente,Criado,Fechado,Motivo');
    expect(row).toContain('"Ana, Maria"');
    expect(row).toContain('"disse ""sim"""');
  });
});
```

- [ ] **Step 2: Rodar e ver passar**

Run: `cd chat-bullq-api && npx jest src/modules/crm-reports --silent`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/modules/crm-reports
git commit -m "test(crm-reports): CSV mapper escapa corretamente"
```

---

## FRONTEND (chat-bullq-web)

### Task 5: Web service crm-reports

**Files:**
- Create: `src/features/crm-reports/services/crm-reports.service.ts`

- [ ] **Step 1: Criar o service**

```ts
import { api } from '@/lib/api';

export type DealStatus = 'OPEN' | 'WON' | 'LOST';

export interface DealsFilters {
  from?: string; to?: string; dateField?: 'createdAt' | 'closedAt';
  pipelineId?: string; stageIds?: string[]; status?: DealStatus;
  assignedToId?: string; valueMin?: string; valueMax?: string;
  hasProposal?: 'true' | 'false'; page?: number; perPage?: number;
}

export interface DealRow {
  id: string; contactName: string | null; pipelineName: string; stageName: string;
  status: DealStatus; value: number | null; assignedToName: string | null;
  createdAt: string; closedAt: string | null; closedReason: string | null;
}

export interface DealsReport {
  metrics: {
    count: number; totalValue: number;
    won: { count: number; value: number }; lost: { count: number; value: number };
    conversionRate: number; avgWonTicket: number;
  };
  rows: DealRow[]; page: number; perPage: number; total: number; totalPages: number;
}

function toParams(f: DealsFilters): Record<string, string> {
  const p: Record<string, string> = {};
  if (f.from) p.from = f.from;
  if (f.to) p.to = f.to;
  if (f.dateField) p.dateField = f.dateField;
  if (f.pipelineId) p.pipelineId = f.pipelineId;
  if (f.stageIds?.length) p.stageIds = f.stageIds.join(',');
  if (f.status) p.status = f.status;
  if (f.assignedToId) p.assignedToId = f.assignedToId;
  if (f.valueMin) p.valueMin = f.valueMin;
  if (f.valueMax) p.valueMax = f.valueMax;
  if (f.hasProposal) p.hasProposal = f.hasProposal;
  if (f.page) p.page = String(f.page);
  if (f.perPage) p.perPage = String(f.perPage);
  return p;
}

export const crmReportsService = {
  async getDeals(f: DealsFilters): Promise<DealsReport> {
    const { data } = await api.get('/crm-reports/deals', { params: toParams(f) });
    return data.data ?? data;
  },
  exportDealsUrl(f: DealsFilters): { path: string; params: Record<string, string> } {
    return { path: '/crm-reports/deals/export.csv', params: toParams(f) };
  },
  async downloadDealsCsv(f: DealsFilters): Promise<Blob> {
    const { data } = await api.get('/crm-reports/deals/export.csv', {
      params: toParams(f), responseType: 'blob',
    });
    return data as Blob;
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `cd chat-bullq-web && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/features/crm-reports/services
git commit -m "feat(crm-reports): web service (deals)"
```

---

### Task 6: Página /relatorios + seletor de fonte + nav

**Files:**
- Create: `src/app/(dashboard)/relatorios/page.tsx`
- Create: `src/features/crm-reports/components/deals-report.tsx`
- Modify: `src/components/layout/app-sidebar.tsx` (add nav item)

- [ ] **Step 1: Nav item**

Em `app-sidebar.tsx`, no array de itens (perto de `/relatorios-vendas`), adicionar:
```tsx
  { href: '/relatorios', label: 'Relatórios', icon: BarChart3 },
```
(reusa o ícone `BarChart3` já importado.)

- [ ] **Step 2: Página com seletor de fonte**

`src/app/(dashboard)/relatorios/page.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { DealsReport } from '@/features/crm-reports/components/deals-report';

type Source = 'deals' | 'leads' | 'conversations';

const SOURCES: { key: Source; label: string; enabled: boolean }[] = [
  { key: 'deals', label: 'Deals / Funil', enabled: true },
  { key: 'leads', label: 'Leads / Contatos', enabled: false },
  { key: 'conversations', label: 'Conversas', enabled: false },
];

export default function RelatoriosPage() {
  const [source, setSource] = useState<Source>('deals');
  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
        <h1 className="mb-4 text-xl font-semibold text-zinc-900 dark:text-zinc-100">Relatórios</h1>
        <div className="mb-5 flex gap-2">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              disabled={!s.enabled}
              onClick={() => s.enabled && setSource(s.key)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                source === s.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 disabled:opacity-40 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
              title={s.enabled ? '' : 'Em breve'}
            >
              {s.label}
            </button>
          ))}
        </div>
        {source === 'deals' && <DealsReport />}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Componente DealsReport (esqueleto que busca e mostra contagem)**

`src/features/crm-reports/components/deals-report.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { crmReportsService, type DealsFilters } from '../services/crm-reports.service';

const startOfMonthISO = () => {
  const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
};

export function DealsReport() {
  const [filters, setFilters] = useState<DealsFilters>({ from: startOfMonthISO(), page: 1, perPage: 25 });
  const { data, isLoading } = useQuery({
    queryKey: ['crm-report-deals', filters],
    queryFn: () => crmReportsService.getDeals(filters),
  });

  if (isLoading || !data) return <p className="text-sm text-zinc-400">Carregando…</p>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">{data.metrics.count} deals no período.</p>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck + rodar**

Run: `cd chat-bullq-web && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/(dashboard)/relatorios src/features/crm-reports/components src/components/layout/app-sidebar.tsx
git commit -m "feat(crm-reports): página /relatorios + seletor de fonte + nav (deals stub)"
```

---

### Task 7: FilterBar dos Deals

**Files:**
- Create: `src/features/crm-reports/components/deals-filter-bar.tsx`
- Modify: `src/features/crm-reports/components/deals-report.tsx`

- [ ] **Step 1: FilterBar**

`src/features/crm-reports/components/deals-filter-bar.tsx`:
```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { pipelinesService } from '@/features/pipelines/services/pipelines.service';
import type { DealsFilters, DealStatus } from '../services/crm-reports.service';

const PRESETS: { label: string; days: number | 'month' }[] = [
  { label: 'Hoje', days: 0 }, { label: '7 dias', days: 7 },
  { label: '30 dias', days: 30 }, { label: 'Mês', days: 'month' },
];

function presetFrom(p: number | 'month'): string {
  const now = new Date();
  if (p === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const d = new Date(now); d.setDate(d.getDate() - (p as number)); d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export function DealsFilterBar({
  filters, onChange,
}: { filters: DealsFilters; onChange: (f: DealsFilters) => void }) {
  const { data: pipelines } = useQuery({ queryKey: ['pipelines'], queryFn: () => pipelinesService.list() });
  const set = (patch: Partial<DealsFilters>) => onChange({ ...filters, ...patch, page: 1 });

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex gap-1">
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => set({ from: presetFrom(p.days), to: undefined })}
            className="rounded-md bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300">
            {p.label}
          </button>
        ))}
      </div>
      <label className="flex flex-col text-[11px] text-zinc-500">Pipeline
        <select value={filters.pipelineId ?? ''} onChange={(e) => set({ pipelineId: e.target.value || undefined, stageIds: undefined })}
          className="mt-0.5 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <option value="">Todos</option>
          {pipelines?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col text-[11px] text-zinc-500">Status
        <select value={filters.status ?? ''} onChange={(e) => set({ status: (e.target.value || undefined) as DealStatus | undefined })}
          className="mt-0.5 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <option value="">Todos</option>
          <option value="OPEN">Aberto</option>
          <option value="WON">Ganho</option>
          <option value="LOST">Perdido</option>
        </select>
      </label>
      <label className="flex flex-col text-[11px] text-zinc-500">Tem proposta
        <select value={filters.hasProposal ?? ''} onChange={(e) => set({ hasProposal: (e.target.value || undefined) as 'true' | 'false' | undefined })}
          className="mt-0.5 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800">
          <option value="">Qualquer</option>
          <option value="true">Sim</option>
          <option value="false">Não</option>
        </select>
      </label>
      <label className="flex flex-col text-[11px] text-zinc-500">Valor mín
        <input value={filters.valueMin ?? ''} onChange={(e) => set({ valueMin: e.target.value || undefined })} inputMode="decimal"
          className="mt-0.5 w-24 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
      </label>
      <label className="flex flex-col text-[11px] text-zinc-500">Valor máx
        <input value={filters.valueMax ?? ''} onChange={(e) => set({ valueMax: e.target.value || undefined })} inputMode="decimal"
          className="mt-0.5 w-24 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800" />
      </label>
    </div>
  );
}
```

(Atendente e etapa podem entrar depois; começar com esses filtros centrais.)

- [ ] **Step 2: Plugar no DealsReport**

Em `deals-report.tsx`, importar `DealsFilterBar` e renderizar acima da contagem:
```tsx
import { DealsFilterBar } from './deals-filter-bar';
// ...dentro do return, antes das métricas:
// <DealsFilterBar filters={filters} onChange={setFilters} />
```
(remover o early-return de loading pra não sumir com a barra; usar um estado de loading local nas métricas.)

- [ ] **Step 3: Typecheck**

Run: `cd chat-bullq-web && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/features/crm-reports/components
git commit -m "feat(crm-reports): filtros dos deals (período/pipeline/status/proposta/valor)"
```

---

### Task 8: MetricsRow + ReportTable + Export

**Files:**
- Create: `src/features/crm-reports/components/deals-metrics.tsx`
- Create: `src/features/crm-reports/components/deals-table.tsx`
- Modify: `src/features/crm-reports/components/deals-report.tsx`

- [ ] **Step 1: MetricsRow**

`src/features/crm-reports/components/deals-metrics.tsx`:
```tsx
import type { DealsReport } from '../services/crm-reports.service';

const brl = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-[11px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-zinc-900 dark:text-zinc-100">{value}</p>
      {hint && <p className="text-[11px] text-zinc-400">{hint}</p>}
    </div>
  );
}

export function DealsMetrics({ m }: { m: DealsReport['metrics'] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
      <Stat label="Deals" value={String(m.count)} />
      <Stat label="Valor total" value={brl(m.totalValue)} />
      <Stat label="Ganhos" value={String(m.won.count)} hint={brl(m.won.value)} />
      <Stat label="Perdidos" value={String(m.lost.count)} hint={brl(m.lost.value)} />
      <Stat label="Conversão" value={`${Math.round(m.conversionRate * 100)}%`} />
      <Stat label="Ticket médio" value={brl(m.avgWonTicket)} />
    </div>
  );
}
```

- [ ] **Step 2: ReportTable com paginação**

`src/features/crm-reports/components/deals-table.tsx`:
```tsx
import type { DealsReport } from '../services/crm-reports.service';

const brl = (n: number | null) =>
  n == null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(n);
const dt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const STATUS_LABEL: Record<string, string> = { OPEN: 'Aberto', WON: 'Ganho', LOST: 'Perdido' };

export function DealsTable({
  report, onPage,
}: { report: DealsReport; onPage: (page: number) => void }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-[11px] uppercase text-zinc-400 dark:border-zinc-800">
            <tr>
              <th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Etapa</th>
              <th className="px-3 py-2">Status</th><th className="px-3 py-2">Valor</th>
              <th className="px-3 py-2">Atendente</th><th className="px-3 py-2">Criado</th>
              <th className="px-3 py-2">Fechado</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
                <td className="px-3 py-2">{r.contactName ?? '—'}</td>
                <td className="px-3 py-2">{r.stageName}</td>
                <td className="px-3 py-2">{STATUS_LABEL[r.status] ?? r.status}</td>
                <td className="px-3 py-2">{brl(r.value)}</td>
                <td className="px-3 py-2">{r.assignedToName ?? '—'}</td>
                <td className="px-3 py-2">{dt(r.createdAt)}</td>
                <td className="px-3 py-2">{dt(r.closedAt)}</td>
              </tr>
            ))}
            {report.rows.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-zinc-400">Nenhum deal no filtro.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {report.totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-2 text-xs text-zinc-500">
          <span>Página {report.page} de {report.totalPages} · {report.total} deals</span>
          <div className="flex gap-1">
            <button disabled={report.page <= 1} onClick={() => onPage(report.page - 1)}
              className="rounded px-2 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800">Anterior</button>
            <button disabled={report.page >= report.totalPages} onClick={() => onPage(report.page + 1)}
              className="rounded px-2 py-1 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800">Próxima</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Montar tudo no DealsReport + botão Exportar**

Reescrever `deals-report.tsx`:
```tsx
'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { crmReportsService, type DealsFilters } from '../services/crm-reports.service';
import { DealsFilterBar } from './deals-filter-bar';
import { DealsMetrics } from './deals-metrics';
import { DealsTable } from './deals-table';

const startOfMonthISO = () => {
  const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
};

export function DealsReport() {
  const [filters, setFilters] = useState<DealsFilters>({ from: startOfMonthISO(), page: 1, perPage: 25 });
  const { data, isFetching } = useQuery({
    queryKey: ['crm-report-deals', filters],
    queryFn: () => crmReportsService.getDeals(filters),
  });

  const handleExport = async () => {
    try {
      const blob = await crmReportsService.downloadDealsCsv({ ...filters, page: 1, perPage: 10000 });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'relatorio-deals.csv'; a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Falha ao exportar'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <DealsFilterBar filters={filters} onChange={setFilters} />
        <button onClick={handleExport}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          <Download className="h-3.5 w-3.5" /> Exportar CSV
        </button>
      </div>
      {data ? (
        <>
          <DealsMetrics m={data.metrics} />
          <DealsTable report={data} onPage={(page) => setFilters((f) => ({ ...f, page }))} />
        </>
      ) : (
        <p className="text-sm text-zinc-400">{isFetching ? 'Carregando…' : 'Sem dados.'}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `cd chat-bullq-web && npx tsc --noEmit -p tsconfig.json`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/crm-reports/components
git commit -m "feat(crm-reports): métricas + tabela paginada + export CSV (deals)"
```

---

## Verificação final

- [ ] `cd chat-bullq-api && npx jest src/modules/crm-reports` — todos verdes.
- [ ] `cd chat-bullq-api && npx tsc --noEmit` — exit 0.
- [ ] `cd chat-bullq-web && npx tsc --noEmit` — exit 0.
- [ ] Abrir `/relatorios` local/preview: seletor mostra Deals ativo; filtros mudam métricas/tabela; export baixa CSV.
- [ ] Login como AGENTE → só deals dele aparecem.

## Deploy (após aprovação)

- PR API (`feat/crm-reports` → `feat/conversation-tabs`) + PR Web.
- VPS: `git reset --hard fork/feat/conversation-tabs` nos dois repos + `docker compose up -d --build api web`. Sem migração.
