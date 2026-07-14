# Filtros no Pipeline de Vendas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma barra de filtros ao board do Pipeline (`/pipelines/[id]`) — vendedor, mês de entrada do lead, mês da viagem, etapa, status, faixa de valor e busca por nome — e exibir a data de entrada do lead no card.

**Architecture:** A filtragem roda **em memória no frontend** sobre os cards que o board já carrega inteiros (função pura `applyFilters`). O único dado que o board não tem hoje — a **data da viagem** — é adicionado no backend: `getBoard` anexa `travelStartDate` (da proposta mais recente do contato) em cada card. Sem migração.

**Tech Stack:** NestJS + Prisma (`chat-bullq-api`), Next.js + React + @tanstack/react-query + @dnd-kit (`chat-bullq-web`). Testes backend: Jest. Frontend sem runner → verificação por `tsc --noEmit`.

**Repos e branch:** os dois repos estão em `Chat OFP/chat-bullq-api` e `Chat OFP/chat-bullq-web`. Trabalhar na branch **`feat/pipeline-filters`** (API já está nela, baseada em `fork/feat/conversation-tabs` = `363e7d5`). No web, criar a mesma branch a partir de `fork/feat/conversation-tabs` antes da Task 3.

---

## File Structure

**Backend (`chat-bullq-api`):**
- Modify: `src/modules/pipelines/pipelines.service.ts` — nova função pura `latestTravelStartByContact` (export) + wiring em `getBoard`.
- Create: `src/modules/pipelines/pipelines.travel-dates.spec.ts` — teste da função pura.

**Frontend (`chat-bullq-web`):**
- Modify: `src/features/pipelines/services/pipelines.service.ts` — campo `travelStartDate` em `CardSummary`.
- Create: `src/features/pipelines/lib/pipeline-filters.ts` — tipos + `applyFilters` + derivadores (vendedores/meses). Lógica pura.
- Create: `src/features/pipelines/components/pipeline-filter-bar.tsx` — a barra de filtros (UI).
- Modify: `src/features/pipelines/components/kanban-board.tsx` — estado do filtro, cards filtrados por etapa, render da barra.
- Modify: `src/features/pipelines/components/kanban-card.tsx` — selo "Entrou dd/mm".

---

## Task 1: Backend — função pura `latestTravelStartByContact`

**Files:**
- Modify: `chat-bullq-api/src/modules/pipelines/pipelines.service.ts`
- Test: `chat-bullq-api/src/modules/pipelines/pipelines.travel-dates.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `chat-bullq-api/src/modules/pipelines/pipelines.travel-dates.spec.ts`:

```ts
import { latestTravelStartByContact } from './pipelines.service';

describe('latestTravelStartByContact', () => {
  it('devolve a startDate da proposta MAIS RECENTE de cada contato', () => {
    const out = latestTravelStartByContact([
      { contactId: 'c1', startDate: new Date('2026-08-10'), createdAt: new Date('2026-07-01') },
      { contactId: 'c1', startDate: new Date('2026-12-20'), createdAt: new Date('2026-07-05') }, // mais recente
      { contactId: 'c2', startDate: new Date('2026-09-01'), createdAt: new Date('2026-06-30') },
    ]);
    expect(out['c1']).toBe(new Date('2026-12-20').toISOString());
    expect(out['c2']).toBe(new Date('2026-09-01').toISOString());
  });

  it('contato sem proposta simplesmente não aparece no mapa', () => {
    const out = latestTravelStartByContact([]);
    expect(out['cX']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (a partir de `chat-bullq-api`): `npx jest pipelines.travel-dates`
Expected: FAIL — `latestTravelStartByContact is not a function` / import não resolve.

- [ ] **Step 3: Write minimal implementation**

Em `chat-bullq-api/src/modules/pipelines/pipelines.service.ts`, adicionar no **topo do arquivo** (após os imports, antes do `@Injectable`):

```ts
/**
 * Dada a lista de propostas de um board, devolve um mapa
 * `contactId -> startDate (ISO)` da proposta MAIS RECENTE (por createdAt) de
 * cada contato. Alimenta o filtro "mês da viagem" no Kanban.
 */
export function latestTravelStartByContact(
  proposals: { contactId: string; startDate: Date; createdAt: Date }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const seenAt: Record<string, number> = {};
  for (const p of proposals) {
    const t = p.createdAt.getTime();
    if (seenAt[p.contactId] === undefined || t > seenAt[p.contactId]) {
      seenAt[p.contactId] = t;
      out[p.contactId] = p.startDate.toISOString();
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest pipelines.travel-dates`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
cd chat-bullq-api
git add src/modules/pipelines/pipelines.service.ts src/modules/pipelines/pipelines.travel-dates.spec.ts
git commit -m "feat(pipelines): helper latestTravelStartByContact (mes da viagem)"
```

---

## Task 2: Backend — anexar `travelStartDate` no `getBoard`

**Files:**
- Modify: `chat-bullq-api/src/modules/pipelines/pipelines.service.ts` (método `getBoard`)

- [ ] **Step 1: Alterar o `getBoard`**

Localizar o método `getBoard` e substituir o trecho final (da montagem de `cardsByStage` até o `return`) por:

```ts
    // Data da viagem: proposta mais recente de cada contato presente no board.
    const contactIds = [
      ...new Set(
        cards.map((c) => c.contactId).filter((x): x is string => !!x),
      ),
    ];
    const travelByContact = contactIds.length
      ? latestTravelStartByContact(
          await this.prisma.proposal.findMany({
            where: { organizationId, contactId: { in: contactIds } },
            select: { contactId: true, startDate: true, createdAt: true },
          }),
        )
      : {};

    const cardsByStage: Record<string, any[]> = {};
    for (const s of stages) cardsByStage[s.id] = [];
    for (const c of cards) {
      (cardsByStage[c.stageId] ||= []).push({
        ...c,
        travelStartDate: c.contactId
          ? (travelByContact[c.contactId] ?? null)
          : null,
      });
    }

    return { pipeline, stages, cards: cardsByStage };
```

(O `const [stages, cards] = await this.prisma.$transaction([...])` acima permanece igual.)

- [ ] **Step 2: Verificar typecheck + suíte inteira sem regressão**

Run (em `chat-bullq-api`): `npx tsc --noEmit && npx jest src/modules/pipelines`
Expected: tsc sem erros; specs de pipelines (order-sent, won, travel-dates) PASS.

- [ ] **Step 3: Commit**

```bash
cd chat-bullq-api
git add src/modules/pipelines/pipelines.service.ts
git commit -m "feat(pipelines): getBoard anexa travelStartDate por card (sem migracao)"
```

---

## Task 3: Frontend — branch + tipo `travelStartDate` + lógica de filtro

**Files:**
- Modify: `chat-bullq-web/src/features/pipelines/services/pipelines.service.ts`
- Create: `chat-bullq-web/src/features/pipelines/lib/pipeline-filters.ts`

- [ ] **Step 1: Criar a branch do web a partir da base viva**

```bash
cd chat-bullq-web
git fetch fork
git checkout -b feat/pipeline-filters fork/feat/conversation-tabs
```

- [ ] **Step 2: Adicionar `travelStartDate` em `CardSummary`**

Em `chat-bullq-web/src/features/pipelines/services/pipelines.service.ts`, na interface `CardSummary`, logo após a linha `updatedAt: string;`, adicionar:

```ts
  /** Data da viagem (startDate da proposta mais recente do contato). Null se não houver proposta. */
  travelStartDate?: string | null;
```

- [ ] **Step 3: Criar a lógica de filtro (pura)**

Create `chat-bullq-web/src/features/pipelines/lib/pipeline-filters.ts`:

```ts
import type { CardSummary } from '../services/pipelines.service';

export interface PipelineFilter {
  vendorId: string | null; // conversation.assignedTo.id ?? assignedTo.id
  entryMonth: string | null; // 'YYYY-MM' sobre createdAt
  travelMonth: string | null; // 'YYYY-MM' sobre travelStartDate
  stageId: string | null;
  status: '' | 'OPEN' | 'WON' | 'LOST';
  minValue: number | null;
  maxValue: number | null;
  search: string; // sobre contact.name / title
}

export const EMPTY_FILTER: PipelineFilter = {
  vendorId: null,
  entryMonth: null,
  travelMonth: null,
  stageId: null,
  status: '',
  minValue: null,
  maxValue: null,
  search: '',
};

export function cardVendorId(c: CardSummary): string | null {
  return c.conversation?.assignedTo?.id ?? c.assignedTo?.id ?? null;
}

export function cardVendorName(c: CardSummary): string | null {
  return c.conversation?.assignedTo?.name ?? c.assignedTo?.name ?? null;
}

function monthOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.slice(0, 7); // ISO começa com 'YYYY-MM'
}

function numValue(v: string | number | null): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? parseFloat(v) : v;
  return Number.isFinite(n) ? (n as number) : null;
}

export function applyFilters(
  cards: CardSummary[],
  f: PipelineFilter,
): CardSummary[] {
  const q = f.search.trim().toLowerCase();
  return cards.filter((c) => {
    if (f.vendorId && cardVendorId(c) !== f.vendorId) return false;
    if (f.entryMonth && monthOf(c.createdAt) !== f.entryMonth) return false;
    if (f.travelMonth && monthOf(c.travelStartDate) !== f.travelMonth) return false;
    if (f.stageId && c.stageId !== f.stageId) return false;
    if (f.status && c.status !== f.status) return false;
    const val = numValue(c.value);
    if (f.minValue != null && (val == null || val < f.minValue)) return false;
    if (f.maxValue != null && (val == null || val > f.maxValue)) return false;
    if (q) {
      const hay = `${c.contact?.name ?? ''} ${c.title ?? ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

const MONTHS_PT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function monthLabel(value: string): string {
  const [y, m] = value.split('-');
  return `${MONTHS_PT[parseInt(m, 10) - 1]}/${y}`;
}

export interface MonthOption {
  value: string;
  label: string;
}

export function deriveMonths(
  cards: CardSummary[],
  field: 'createdAt' | 'travelStartDate',
): MonthOption[] {
  const set = new Set<string>();
  for (const c of cards) {
    const mo = monthOf(field === 'createdAt' ? c.createdAt : c.travelStartDate);
    if (mo) set.add(mo);
  }
  return [...set]
    .sort()
    .reverse()
    .map((value) => ({ value, label: monthLabel(value) }));
}

export interface VendorOption {
  id: string;
  name: string;
}

export function deriveVendors(cards: CardSummary[]): VendorOption[] {
  const map = new Map<string, string>();
  for (const c of cards) {
    const id = cardVendorId(c);
    if (id && !map.has(id)) map.set(id, cardVendorName(c) ?? '—');
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function isFilterActive(f: PipelineFilter): boolean {
  return !!(
    f.vendorId ||
    f.entryMonth ||
    f.travelMonth ||
    f.stageId ||
    f.status ||
    f.minValue != null ||
    f.maxValue != null ||
    f.search.trim()
  );
}
```

- [ ] **Step 4: Typecheck**

Run (em `chat-bullq-web`): `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
cd chat-bullq-web
git add src/features/pipelines/services/pipelines.service.ts src/features/pipelines/lib/pipeline-filters.ts
git commit -m "feat(pipelines): tipo travelStartDate + logica de filtro do board"
```

---

## Task 4: Frontend — componente `PipelineFilterBar`

**Files:**
- Create: `chat-bullq-web/src/features/pipelines/components/pipeline-filter-bar.tsx`

- [ ] **Step 1: Criar o componente**

Create `chat-bullq-web/src/features/pipelines/components/pipeline-filter-bar.tsx`:

```tsx
'use client';

import { X } from 'lucide-react';
import type { PipelineStage } from '../services/pipelines.service';
import {
  type PipelineFilter,
  type MonthOption,
  type VendorOption,
  EMPTY_FILTER,
  isFilterActive,
} from '../lib/pipeline-filters';

interface Props {
  filter: PipelineFilter;
  onChange: (f: PipelineFilter) => void;
  stages: PipelineStage[];
  vendors: VendorOption[];
  entryMonths: MonthOption[];
  travelMonths: MonthOption[];
}

const selectCls =
  'rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-700 focus:border-primary focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200';

export function PipelineFilterBar({
  filter,
  onChange,
  stages,
  vendors,
  entryMonths,
  travelMonths,
}: Props) {
  const set = (patch: Partial<PipelineFilter>) => onChange({ ...filter, ...patch });

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
      <select
        className={selectCls}
        value={filter.vendorId ?? ''}
        onChange={(e) => set({ vendorId: e.target.value || null })}
      >
        <option value="">Todos os vendedores</option>
        {vendors.map((v) => (
          <option key={v.id} value={v.id}>{v.name}</option>
        ))}
      </select>

      <select
        className={selectCls}
        value={filter.entryMonth ?? ''}
        onChange={(e) => set({ entryMonth: e.target.value || null })}
      >
        <option value="">Entrada: qualquer mês</option>
        {entryMonths.map((m) => (
          <option key={m.value} value={m.value}>Entrada: {m.label}</option>
        ))}
      </select>

      <select
        className={selectCls}
        value={filter.travelMonth ?? ''}
        onChange={(e) => set({ travelMonth: e.target.value || null })}
      >
        <option value="">Viagem: qualquer mês</option>
        {travelMonths.map((m) => (
          <option key={m.value} value={m.value}>Viagem: {m.label}</option>
        ))}
      </select>

      <select
        className={selectCls}
        value={filter.stageId ?? ''}
        onChange={(e) => set({ stageId: e.target.value || null })}
      >
        <option value="">Todas as etapas</option>
        {stages.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      <select
        className={selectCls}
        value={filter.status}
        onChange={(e) => set({ status: e.target.value as PipelineFilter['status'] })}
      >
        <option value="">Qualquer status</option>
        <option value="OPEN">Aberto</option>
        <option value="WON">Ganho</option>
        <option value="LOST">Perdido</option>
      </select>

      <input
        type="number"
        inputMode="numeric"
        placeholder="Valor mín."
        className={`${selectCls} w-24`}
        value={filter.minValue ?? ''}
        onChange={(e) =>
          set({ minValue: e.target.value === '' ? null : Number(e.target.value) })
        }
      />
      <input
        type="number"
        inputMode="numeric"
        placeholder="Valor máx."
        className={`${selectCls} w-24`}
        value={filter.maxValue ?? ''}
        onChange={(e) =>
          set({ maxValue: e.target.value === '' ? null : Number(e.target.value) })
        }
      />

      <input
        type="search"
        placeholder="Buscar por nome…"
        className={`${selectCls} min-w-[10rem] flex-1`}
        value={filter.search}
        onChange={(e) => set({ search: e.target.value })}
      />

      {isFilterActive(filter) && (
        <button
          type="button"
          onClick={() => onChange(EMPTY_FILTER)}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 px-2 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <X className="h-3.5 w-3.5" /> Limpar
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run (em `chat-bullq-web`): `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
cd chat-bullq-web
git add src/features/pipelines/components/pipeline-filter-bar.tsx
git commit -m "feat(pipelines): componente PipelineFilterBar"
```

---

## Task 5: Frontend — ligar o filtro no `KanbanBoard`

**Files:**
- Modify: `chat-bullq-web/src/features/pipelines/components/kanban-board.tsx`

- [ ] **Step 1: Imports**

No topo de `kanban-board.tsx`, adicionar aos imports existentes:

```ts
import { PipelineFilterBar } from './pipeline-filter-bar';
import {
  type PipelineFilter,
  EMPTY_FILTER,
  applyFilters,
  deriveVendors,
  deriveMonths,
} from '../lib/pipeline-filters';
```

(`useState`, `useMemo` já são importados de `react` no arquivo.)

- [ ] **Step 2: Estado + derivações**

Dentro do componente `KanbanBoard`, logo após a linha `const [viewingConvId, setViewingConvId] = useState<string | null>(null);`, adicionar:

```ts
  const [filter, setFilter] = useState<PipelineFilter>(EMPTY_FILTER);
```

E logo após o bloco `const { data: board, isLoading } = useQuery({...});`, adicionar:

```ts
  const allCards = useMemo(
    () => (board ? Object.values(board.cards).flat() : []),
    [board],
  );
  const vendors = useMemo(() => deriveVendors(allCards), [allCards]);
  const entryMonths = useMemo(() => deriveMonths(allCards, 'createdAt'), [allCards]);
  const travelMonths = useMemo(
    () => deriveMonths(allCards, 'travelStartDate'),
    [allCards],
  );
  const filteredByStage = useMemo(() => {
    const out: Record<string, typeof allCards> = {};
    if (board) {
      for (const s of board.stages) {
        out[s.id] = applyFilters(board.cards[s.id] ?? [], filter);
      }
    }
    return out;
  }, [board, filter]);
```

- [ ] **Step 3: Renderizar a barra e passar cards filtrados**

Substituir o bloco `return ( <> <DndContext ... > <div className="flex h-full gap-3 overflow-x-auto px-4 pb-4"> {board.stages.map(...)} </div> <DragOverlay>...</DragOverlay> </DndContext>` pela versão com barra e wrapper flex-column. Trocar apenas a estrutura externa e a prop `cards`:

```tsx
  return (
    <>
      <div className="flex h-full flex-col">
        <PipelineFilterBar
          filter={filter}
          onChange={setFilter}
          stages={board.stages}
          vendors={vendors}
          entryMonths={entryMonths}
          travelMonths={travelMonths}
        />
        <div className="min-h-0 flex-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="flex h-full gap-3 overflow-x-auto px-4 pb-4">
              {board.stages.map((stage) => (
                <KanbanColumn
                  key={stage.id}
                  stage={stage}
                  cards={filteredByStage[stage.id] ?? []}
                  onAddCard={() => setAddStageId(stage.id)}
                  onCardClick={(c) => {
                    setViewingCard(c);
                  }}
                />
              ))}
            </div>
            <DragOverlay>
              {activeCard ? <KanbanCard card={activeCard} /> : null}
            </DragOverlay>
          </DndContext>
        </div>
      </div>
```

**Importante:** os handlers de drag (`handleDragStart`, `handleDragEnd`, `cardIndex`) continuam operando sobre `board.cards` (a lista completa) — NÃO trocar para `filteredByStage`. Só a exibição usa os filtrados; a fonte da verdade do drag é o board inteiro. Isso preserva o mover-card mesmo com filtro ativo.

Os dialogs (`<CardDialog>`, `<ClientCardDialog>`, `<AddConversationDialog>`, `<ConversationDialog>`) e o fechamento `</>` permanecem exatamente como estão, logo após o `</div>` que fecha o novo wrapper flex-column.

- [ ] **Step 4: Typecheck**

Run (em `chat-bullq-web`): `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
cd chat-bullq-web
git add src/features/pipelines/components/kanban-board.tsx
git commit -m "feat(pipelines): barra de filtros ligada ao board (filtragem em memoria)"
```

---

## Task 6: Frontend — selo "Entrou dd/mm" no card

**Files:**
- Modify: `chat-bullq-web/src/features/pipelines/components/kanban-card.tsx`

- [ ] **Step 1: Import do ícone**

Na linha de import do `lucide-react` (`import { GripVertical, MessageSquare, User } from 'lucide-react';`), adicionar `CalendarDays`:

```ts
import { CalendarDays, GripVertical, MessageSquare, User } from 'lucide-react';
```

- [ ] **Step 2: Helper de formatação**

Logo após a função `formatBRL` (antes de `interface KirvanoMeta`), adicionar:

```ts
const fmtDayMonth = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};
```

- [ ] **Step 3: Renderizar o selo**

Dentro da row de chips (o `<div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">`), adicionar como **primeiro** filho, antes do bloco de temperatura:

```tsx
        {fmtDayMonth(card.createdAt) && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            title="Data de entrada do lead"
          >
            <CalendarDays className="h-3 w-3" /> Entrou {fmtDayMonth(card.createdAt)}
          </span>
        )}
```

- [ ] **Step 4: Typecheck**

Run (em `chat-bullq-web`): `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
cd chat-bullq-web
git add src/features/pipelines/components/kanban-card.tsx
git commit -m "feat(pipelines): selo de data de entrada do lead no card"
```

---

## Task 7: Verificação final + push

- [ ] **Step 1: Build completo dos dois repos**

```bash
cd chat-bullq-api && npx tsc --noEmit && npx jest src/modules/pipelines
cd ../chat-bullq-web && npx tsc --noEmit && npm run build
```
Expected: tsc limpo nos dois; jest de pipelines verde; `next build` conclui sem erro.

- [ ] **Step 2: Push das duas branches**

```bash
cd chat-bullq-api && git push -u fork feat/pipeline-filters
cd ../chat-bullq-web && git push -u fork feat/pipeline-filters
```

- [ ] **Step 3: Abrir os PRs (base `feat/conversation-tabs`)**

```bash
cd chat-bullq-api && gh pr create --base feat/conversation-tabs --head feat/pipeline-filters \
  --title "feat(pipelines): filtros do board + travelStartDate" \
  --body "Filtros no board do Pipeline (vendedor, mês de entrada, mês da viagem, etapa, status, faixa de valor, busca) + selo de data de entrada no card. Backend anexa travelStartDate (proposta mais recente) no getBoard, sem migração."
cd ../chat-bullq-web && gh pr create --base feat/conversation-tabs --head feat/pipeline-filters \
  --title "feat(pipelines): barra de filtros no board + selo de entrada" \
  --body "Barra de filtros (filtragem em memória) + selo 'Entrou dd/mm' no card. Consome travelStartDate do getBoard."
```

**Merge + rebuild no VPS (api + web, sem migração) + validação na tela ficam com o usuário** (Claude não alcança o VPS).

---

## Notas de deploy
- **Sem migração** — apenas rebuild `api` e `web`.
- Pós-deploy: abrir `/pipelines/[id]`, testar cada filtro, conferir contador/soma das colunas reagindo ao filtro, e o selo "Entrou dd/mm" no card. Card sem proposta some ao filtrar por mês da viagem (esperado).
