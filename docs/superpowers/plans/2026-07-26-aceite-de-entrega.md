# Aceite de Entrega — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando o atendente aciona "Pedido enviado", gerar um link de aceite eletrônico; o cliente confere os itens numa página web, assina (nome + checkbox), e o sistema grava a assinatura, gera um comprovante em PDF e registra tudo no chat/card.

**Architecture:** Módulo isolado `acceptances` no `chat-bullq-api` com model próprio (`OrderAcceptance`), controller autenticado (atendente) e controller público (`@Public()`, assinatura por token). Rota pública mobile-first no `chat-bullq-web` (`/aceite/[token]`). Reusa `StorageService.put` (MinIO), Chromium/Playwright (padrão de `render.service`) pro PDF, o padrão de mensagem SYSTEM no thread + realtime `card:updated`, e `GET order-ficha/conversation/:id` pro rascunho de itens.

**Tech Stack:** NestJS + Prisma 6 + Postgres (multitenant por `organizationId`, sem RLS), BullMQ, MinIO, Playwright (chromium), Socket.IO (RealtimeGateway); Next.js (App Router) + React no web.

**Base branches (CRÍTICO):**
- API: criar `feat/aceite-de-entrega` a partir de `fork/feat/conversation-tabs` (deploy vivo; é onde `OrderFicha` e o módulo `order-ficha` existem).
- Web: criar `feat/aceite-de-entrega-web` a partir de `fork/feat/conversation-tabs`.
- NÃO basear em `feat/saudacao-atendente` (checkout atual da API) nem `feat/pipeline-filters-a11y` (checkout atual do web) — são anteriores à Ficha.

---

## File Structure

### API (`chat-bullq-api`)
- Create: `src/modules/acceptances/acceptances.module.ts` — wiring do módulo.
- Create: `src/modules/acceptances/acceptance-token.util.ts` — geração de token opaco.
- Create: `src/modules/acceptances/acceptances.types.ts` — `AcceptanceItem`, views.
- Create: `src/modules/acceptances/acceptances.service.ts` — create/getByToken/sign/resend/status.
- Create: `src/modules/acceptances/acceptance-pdf.service.ts` — HTML→PDF via chromium.
- Create: `src/modules/acceptances/acceptance-effects.service.ts` — SYSTEM msg + selo no card + realtime.
- Create: `src/modules/acceptances/acceptances.controller.ts` — autenticado (resend, status).
- Create: `src/modules/acceptances/public-acceptances.controller.ts` — `@Public()` (get, sign).
- Create: `src/modules/acceptances/dto/create-acceptance.dto.ts`, `sign-acceptance.dto.ts`.
- Create tests ao lado de cada `.service.ts` (`*.spec.ts`).
- Modify: `prisma/schema.prisma` — model `OrderAcceptance` + enum `AcceptanceStatus` + relações.
- Create: `prisma/migrations/<ts>_add_order_acceptance/migration.sql`.
- Modify: `src/modules/pipelines/pipelines.controller.ts` — `order-sent` aceita body opcional.
- Modify: `src/modules/pipelines/pipelines.service.ts` — orquestra criação do aceite no order-sent.
- Modify: `src/app.module.ts` — importa `AcceptancesModule`.

### Web (`chat-bullq-web`)
- Create: `src/features/acceptances/services/acceptances.service.ts` — client autenticado.
- Create: `src/features/acceptances/services/public-acceptances.service.ts` — client público.
- Create: `src/features/acceptances/types.ts`.
- Create: `src/features/acceptances/components/acceptance-dialog.tsx` — diálogo do order-sent.
- Create: `src/features/acceptances/components/acceptance-status-block.tsx` — bloco no drawer.
- Create: `src/app/aceite/[token]/page.tsx` — página pública (fora dos grupos autenticados).
- Modify: `src/features/inbox/components/chat-input.tsx` — abrir o diálogo no lugar do `confirm`.
- Modify: `src/features/pipelines/services/pipelines.service.ts` — `markOrderSent` aceita payload.
- Modify: `src/features/inbox/components/client-card-drawer.tsx` — inserir o bloco de status.

---

## Env

Adicionar ao `.env` da API (e ao compose do deploy):
```
APP_PUBLIC_URL=https://sendtur.com.br
```
Base do link de aceite: `${APP_PUBLIC_URL}/aceite/<token>`. Se ausente, o service lança erro claro na criação (não gera link quebrado).

---

## Task 0: Branches de trabalho

**Files:** nenhum (git).

- [ ] **Step 1: Criar branch da API a partir do deploy vivo**

```bash
cd chat-bullq-api
git fetch fork
git checkout -b feat/aceite-de-entrega fork/feat/conversation-tabs
```

- [ ] **Step 2: Criar branch do web a partir do deploy vivo**

```bash
cd ../chat-bullq-web
git fetch fork
git checkout -b feat/aceite-de-entrega-web fork/feat/conversation-tabs
```

- [ ] **Step 3: Copiar spec+plan pra dentro dos repos (versionar junto)**

```bash
cd ../chat-bullq-api
mkdir -p docs/superpowers/specs docs/superpowers/plans
cp "../docs/superpowers/specs/2026-07-26-aceite-de-entrega-design.md" docs/superpowers/specs/
cp "../docs/superpowers/plans/2026-07-26-aceite-de-entrega.md" docs/superpowers/plans/
git add docs/superpowers && git commit -m "docs: spec e plano do Aceite de Entrega"
```

---

## Task 1: Prisma — model `OrderAcceptance` + enum + migration

**Files:**
- Modify: `chat-bullq-api/prisma/schema.prisma`
- Create: `chat-bullq-api/prisma/migrations/<ts>_add_order_acceptance/migration.sql`

- [ ] **Step 1: Adicionar o enum e o model no schema**

No fim de `prisma/schema.prisma` (perto de `OrderFicha`, seguindo o mesmo estilo de `@map`):

```prisma
enum AcceptanceStatus {
  PENDING
  SIGNED
  EXPIRED
  CANCELED
}

model OrderAcceptance {
  id              String           @id @default(cuid())
  organizationId  String           @map("organization_id")
  conversationId  String           @map("conversation_id")
  contactId       String           @map("contact_id")
  cardId          String?          @map("card_id")

  token           String           @unique
  items           Json             @default("[]")
  termText        String           @map("term_text")
  status          AcceptanceStatus @default(PENDING)

  createdById     String           @map("created_by_id")
  createdAt       DateTime         @default(now()) @map("created_at")
  expiresAt       DateTime?        @map("expires_at")

  signedAt        DateTime?        @map("signed_at")
  signerName      String?          @map("signer_name")
  signerIp        String?          @map("signer_ip")
  signerUserAgent String?          @map("signer_user_agent")
  pdfKey          String?          @map("pdf_key")

  organization    Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  contact         Contact          @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@index([organizationId, conversationId])
  @@index([organizationId, status])
  @@map("order_acceptances")
}
```

Adicionar as back-relations (uma linha em cada model, seguindo como `orderFichas` foi adicionado):
- Em `model Organization { ... }`: `orderAcceptances   OrderAcceptance[]`
- Em `model Contact { ... }`: `orderAcceptances   OrderAcceptance[]`

- [ ] **Step 2: Gerar a migration**

Run:
```bash
cd chat-bullq-api
npx prisma migrate dev --name add_order_acceptance --create-only
```
Expected: cria `prisma/migrations/<ts>_add_order_acceptance/migration.sql` com `CREATE TYPE "AcceptanceStatus"` e `CREATE TABLE "order_acceptances"`. **Confira que é 100% aditiva** (só CREATE, nenhum ALTER destrutivo em tabela existente).

- [ ] **Step 3: Aplicar e gerar client**

Run:
```bash
npx prisma migrate dev && npx prisma generate
```
Expected: migration aplicada; `OrderAcceptance` disponível no `PrismaClient`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(acceptances): model OrderAcceptance + migration aditiva"
```

---

## Task 2: Token opaco (TDD)

**Files:**
- Create: `src/modules/acceptances/acceptance-token.util.ts`
- Test: `src/modules/acceptances/acceptance-token.util.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// acceptance-token.util.spec.ts
import { generateAcceptanceToken } from './acceptance-token.util';

describe('generateAcceptanceToken', () => {
  it('gera token url-safe sem padding, >= 40 chars', () => {
    const t = generateAcceptanceToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(40);
  });

  it('gera valores distintos a cada chamada', () => {
    expect(generateAcceptanceToken()).not.toBe(generateAcceptanceToken());
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest acceptance-token.util -c jest.config.js`
Expected: FAIL — `Cannot find module './acceptance-token.util'`.

- [ ] **Step 3: Implementar**

```ts
// acceptance-token.util.ts
import { randomBytes } from 'crypto';

/** Token opaco de 32 bytes (base64url, sem padding) — é o único fator de
 *  acesso à página pública, então precisa ser imprevisível. */
export function generateAcceptanceToken(): string {
  return randomBytes(32).toString('base64url');
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest acceptance-token.util -c jest.config.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/acceptances/acceptance-token.util.*
git commit -m "feat(acceptances): gerador de token opaco"
```

---

## Task 3: Types + DTOs

**Files:**
- Create: `src/modules/acceptances/acceptances.types.ts`
- Create: `src/modules/acceptances/dto/create-acceptance.dto.ts`
- Create: `src/modules/acceptances/dto/sign-acceptance.dto.ts`

- [ ] **Step 1: Types**

```ts
// acceptances.types.ts
export interface AcceptanceItem {
  description: string;
  qty?: number;
  date?: string;
  note?: string;
}

/** O que a página pública pode ver (sem PII interna). */
export interface PublicAcceptanceView {
  status: 'PENDING' | 'SIGNED' | 'EXPIRED' | 'CANCELED';
  organizationName: string;
  items: AcceptanceItem[];
  termText: string;
  signedAt: string | null;
  signerName: string | null;
  pdfUrl: string | null;
}
```

- [ ] **Step 2: create DTO**

```ts
// dto/create-acceptance.dto.ts
import { IsArray, IsBoolean, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AcceptanceItemDto {
  @IsString() description: string;
  @IsOptional() qty?: number;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() note?: string;
}

/** Body opcional do `order-sent`. Sem ele, o endpoint só move o card (legado). */
export class OrderSentDto {
  @IsOptional() @IsBoolean() withAcceptance?: boolean;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => AcceptanceItemDto)
  items?: AcceptanceItemDto[];

  @IsOptional() @IsString() termText?: string;
}
```

- [ ] **Step 3: sign DTO**

```ts
// dto/sign-acceptance.dto.ts
import { IsString, MinLength } from 'class-validator';

export class SignAcceptanceDto {
  @IsString() @MinLength(2) name: string;
}
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/acceptances/acceptances.types.ts src/modules/acceptances/dto
git commit -m "feat(acceptances): types e DTOs"
```

---

## Task 4: `AcceptancesService.createForConversation` (TDD)

**Files:**
- Create: `src/modules/acceptances/acceptances.service.ts`
- Test: `src/modules/acceptances/acceptances.service.spec.ts`

Constante do termo default (topo do service):
```ts
const DEFAULT_TERM = (org: string) =>
  `Declaro que recebi de ${org} os itens listados abaixo, que conferi cada um deles e que está tudo correto.`;
const ACCEPTANCE_TTL_DAYS = 30;
```

- [ ] **Step 1: Teste que falha**

```ts
// acceptances.service.spec.ts
import { BadRequestException } from '@nestjs/common';
import { AcceptancesService } from './acceptances.service';

function makePrisma(over: any = {}) {
  return {
    conversation: { findFirst: jest.fn().mockResolvedValue({
      id: 'conv-1', organizationId: 'org-1', contactId: 'ct-1',
      organization: { name: 'Orlando Fast Pass' },
    }) },
    card: { findFirst: jest.fn().mockResolvedValue({ id: 'card-1' }) },
    orderAcceptance: { create: jest.fn().mockImplementation(({ data }) => ({ id: 'acc-1', ...data })) },
    ...over,
  } as any;
}

describe('AcceptancesService.createForConversation', () => {
  const env = process.env;
  beforeEach(() => { process.env = { ...env, APP_PUBLIC_URL: 'https://x.test' }; });
  afterEach(() => { process.env = env; });

  it('cria aceite PENDING com token, snapshot e expiresAt, e devolve o link', async () => {
    const prisma = makePrisma();
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any);
    const { acceptance, link } = await svc.createForConversation('org-1', 'conv-1', {
      items: [{ description: 'Ingresso Disney' }],
      termText: undefined,
      createdById: 'user-1',
    });
    expect(acceptance.status).toBe('PENDING');
    expect(acceptance.token).toEqual(expect.any(String));
    expect(acceptance.expiresAt).toBeInstanceOf(Date);
    expect(link).toBe(`https://x.test/aceite/${acceptance.token}`);
    expect(prisma.orderAcceptance.create).toHaveBeenCalledTimes(1);
  });

  it('lança se APP_PUBLIC_URL não estiver setado', async () => {
    delete process.env.APP_PUBLIC_URL;
    const svc = new AcceptancesService(makePrisma(), {} as any, {} as any, {} as any);
    await expect(svc.createForConversation('org-1', 'conv-1', {
      items: [{ description: 'x' }], createdById: 'u',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita conversa de outra org', async () => {
    const prisma = makePrisma({ conversation: { findFirst: jest.fn().mockResolvedValue(null) } });
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any);
    await expect(svc.createForConversation('org-1', 'conv-x', {
      items: [], createdById: 'u',
    })).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest acceptances.service -c jest.config.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o service (só o create por enquanto)**

```ts
// acceptances.service.ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AcceptancePdfService } from './acceptance-pdf.service';
import { AcceptanceEffectsService } from './acceptance-effects.service';
import { StorageService } from '../storage/storage.service';
import { generateAcceptanceToken } from './acceptance-token.util';
import { AcceptanceItem, PublicAcceptanceView } from './acceptances.types';

const DEFAULT_TERM = (org: string) =>
  `Declaro que recebi de ${org} os itens listados abaixo, que conferi cada um deles e que está tudo correto.`;
const ACCEPTANCE_TTL_DAYS = 30;

@Injectable()
export class AcceptancesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pdf: AcceptancePdfService,
    private readonly effects: AcceptanceEffectsService,
    private readonly storage: StorageService,
  ) {}

  private baseUrl(): string {
    const url = process.env.APP_PUBLIC_URL;
    if (!url) throw new BadRequestException('APP_PUBLIC_URL não configurado — não é possível gerar o link de aceite.');
    return url.replace(/\/+$/, '');
  }

  async createForConversation(
    organizationId: string,
    conversationId: string,
    input: { items: AcceptanceItem[]; termText?: string; createdById: string },
  ): Promise<{ acceptance: any; link: string }> {
    const base = this.baseUrl();
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
      include: { organization: { select: { name: true } } },
    });
    if (!conv) throw new BadRequestException('Conversa não encontrada nesta organização.');

    const card = await this.prisma.card.findFirst({
      where: { conversationId, organizationId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    const token = generateAcceptanceToken();
    const expiresAt = new Date(Date.now() + ACCEPTANCE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const acceptance = await this.prisma.orderAcceptance.create({
      data: {
        organizationId,
        conversationId,
        contactId: conv.contactId,
        cardId: card?.id ?? null,
        token,
        items: (input.items ?? []) as any,
        termText: input.termText?.trim() || DEFAULT_TERM(conv.organization.name),
        status: 'PENDING',
        createdById: input.createdById,
        expiresAt,
      },
    });
    return { acceptance, link: `${base}/aceite/${token}` };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest acceptances.service -c jest.config.js`
Expected: PASS (os 3 casos do create).

- [ ] **Step 5: Commit**

```bash
git add src/modules/acceptances/acceptances.service.*
git commit -m "feat(acceptances): createForConversation com token+snapshot+link"
```

---

## Task 5: `AcceptancePdfService` (TDD)

**Files:**
- Create: `src/modules/acceptances/acceptance-pdf.service.ts`
- Test: `src/modules/acceptances/acceptance-pdf.service.spec.ts`

Padrão idêntico ao `render.service.ts`: `browserType` injetável, `launch` com `--no-sandbox`, sempre fecha.

- [ ] **Step 1: Teste que falha (browser fake)**

```ts
// acceptance-pdf.service.spec.ts
import { AcceptancePdfService } from './acceptance-pdf.service';

function fakeBrowserType(pdfBuf = Buffer.from('%PDF-1.4 fake')) {
  const page = {
    setContent: jest.fn().mockResolvedValue(undefined),
    pdf: jest.fn().mockResolvedValue(pdfBuf),
  };
  const browser = { newPage: jest.fn().mockResolvedValue(page), close: jest.fn().mockResolvedValue(undefined) };
  return { launch: jest.fn().mockResolvedValue(browser), _page: page, _browser: browser } as any;
}

describe('AcceptancePdfService', () => {
  it('renderiza HTML do termo e devolve o buffer do PDF, fechando o browser', async () => {
    const bt = fakeBrowserType();
    const svc = new AcceptancePdfService(bt);
    const buf = await svc.render({
      organizationName: 'Orlando Fast Pass',
      termText: 'Declaro que recebi...',
      items: [{ description: 'Ingresso Disney', qty: 2 }],
      signerName: 'João Silva',
      signedAt: new Date('2026-07-26T14:00:00Z'),
      signerIp: '1.2.3.4',
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(bt._page.setContent).toHaveBeenCalledWith(expect.stringContaining('Ingresso Disney'), expect.any(Object));
    expect(bt._page.setContent).toHaveBeenCalledWith(expect.stringContaining('João Silva'), expect.any(Object));
    expect(bt._browser.close).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest acceptance-pdf.service -c jest.config.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
// acceptance-pdf.service.ts
import { Injectable } from '@nestjs/common';
import { chromium, type BrowserType } from 'playwright';
import { AcceptanceItem } from './acceptances.types';

export interface AcceptancePdfInput {
  organizationName: string;
  termText: string;
  items: AcceptanceItem[];
  signerName: string;
  signedAt: Date;
  signerIp?: string | null;
}

function esc(s: string): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

@Injectable()
export class AcceptancePdfService {
  constructor(private readonly browserType: BrowserType = chromium) {}

  private html(i: AcceptancePdfInput): string {
    const rows = i.items.map((it) => `<li>${esc(it.description)}${
      it.qty ? ` — <strong>${it.qty}x</strong>` : ''}${it.date ? ` (${esc(it.date)})` : ''}${
      it.note ? ` — ${esc(it.note)}` : ''}</li>`).join('');
    const when = i.signedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"/>
      <style>body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:40px;line-height:1.5}
      h1{font-size:20px}ul{padding-left:20px}.meta{margin-top:32px;font-size:12px;color:#444;border-top:1px solid #ddd;padding-top:16px}</style>
      </head><body>
      <h1>Comprovante de Aceite — ${esc(i.organizationName)}</h1>
      <p>${esc(i.termText)}</p>
      <h3>Itens conferidos</h3><ul>${rows}</ul>
      <div class="meta">
        <div><strong>Assinado por:</strong> ${esc(i.signerName)}</div>
        <div><strong>Data/hora:</strong> ${esc(when)} (Brasília)</div>
        ${i.signerIp ? `<div><strong>IP:</strong> ${esc(i.signerIp)}</div>` : ''}
        <div>Assinatura eletrônica simples (MP 2.200-2/2001).</div>
      </div></body></html>`;
  }

  async render(input: AcceptancePdfInput): Promise<Buffer> {
    const browser = await this.browserType.launch({
      headless: true,
      executablePath: process.env.PROPOSAL_CHROMIUM_PATH || undefined,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(this.html(input), { waitUntil: 'load' });
      return (await page.pdf({ format: 'A4', printBackground: true })) as Buffer;
    } finally {
      await browser.close();
    }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest acceptance-pdf.service -c jest.config.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/acceptances/acceptance-pdf.service.*
git commit -m "feat(acceptances): geração do comprovante PDF via chromium"
```

---

## Task 6: `AcceptanceEffectsService` — SYSTEM msg + selo no card + realtime (TDD)

**Files:**
- Create: `src/modules/acceptances/acceptance-effects.service.ts`
- Test: `src/modules/acceptances/acceptance-effects.service.spec.ts`

O selo vai em `Card.metadata.acceptance = { status, signedAt }` (JSON já existente no model Card, usado por outras features). O drawer/o board leem daí.

- [ ] **Step 1: Teste que falha**

```ts
// acceptance-effects.service.spec.ts
import { AcceptanceEffectsService } from './acceptance-effects.service';

describe('AcceptanceEffectsService.onSigned', () => {
  it('posta SYSTEM msg no thread, seta selo no card e emite realtime', async () => {
    const sysMsg = { id: 'sys-1' };
    const prisma = {
      conversation: { findUnique: jest.fn().mockResolvedValue({ id: 'conv-1', channelId: 'ch-1', contactId: 'ct-1' }) },
      message: { create: jest.fn().mockResolvedValue(sysMsg) },
      card: { update: jest.fn().mockResolvedValue({ id: 'card-1', metadata: { acceptance: { status: 'SIGNED' } } }) },
    } as any;
    const realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn(), emitToOrg: jest.fn() } as any;
    const svc = new AcceptanceEffectsService(prisma, realtime);

    await svc.onSigned({
      id: 'acc-1', organizationId: 'org-1', conversationId: 'conv-1', cardId: 'card-1',
      signerName: 'João', signedAt: new Date('2026-07-26T14:00:00Z'),
    } as any);

    expect(prisma.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ conversationId: 'conv-1', type: 'SYSTEM' }),
    }));
    expect(prisma.card.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'card-1' } }));
    expect(realtime.emitToConversation).toHaveBeenCalledWith('conv-1', 'message:new', { message: sysMsg });
    expect(realtime.emitToOrg).toHaveBeenCalledWith('org-1', 'card:updated', expect.any(Object));
  });

  it('sem card não quebra (só posta a SYSTEM msg)', async () => {
    const prisma = {
      conversation: { findUnique: jest.fn().mockResolvedValue({ id: 'conv-1', channelId: 'ch-1', contactId: 'ct-1' }) },
      message: { create: jest.fn().mockResolvedValue({ id: 'sys-1' }) },
      card: { update: jest.fn() },
    } as any;
    const realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn(), emitToOrg: jest.fn() } as any;
    const svc = new AcceptanceEffectsService(prisma, realtime);
    await svc.onSigned({ id: 'a', organizationId: 'org-1', conversationId: 'conv-1', cardId: null,
      signerName: 'João', signedAt: new Date() } as any);
    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(prisma.message.create).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest acceptance-effects.service -c jest.config.js`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar (espelhando o padrão de transfer/divergência)**

```ts
// acceptance-effects.service.ts
import { Injectable } from '@nestjs/common';
import { MessageContentType, MessageDirection, MessageStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class AcceptanceEffectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async onSigned(acc: {
    id: string; organizationId: string; conversationId: string;
    cardId: string | null; signerName: string; signedAt: Date;
  }): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: acc.conversationId },
      select: { id: true, channelId: true, contactId: true },
    });
    if (!conv) return;

    const when = acc.signedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const text = `✅ Cliente confirmou o recebimento — ${acc.signerName} em ${when}`;

    const systemMessage = await this.prisma.message.create({
      data: {
        conversationId: acc.conversationId,
        direction: MessageDirection.OUTBOUND,
        type: MessageContentType.SYSTEM,
        status: MessageStatus.SENT,
        sentAt: new Date(),
        content: { text, acceptance: { id: acc.id, status: 'SIGNED' } },
      },
    });

    this.realtime.emitToChannel(conv.channelId, 'message:new', {
      message: systemMessage, conversationId: conv.id, contactId: conv.contactId,
    });
    this.realtime.emitToConversation(conv.id, 'message:new', { message: systemMessage });

    if (acc.cardId) {
      const card = await this.prisma.card.update({
        where: { id: acc.cardId },
        data: { metadata: { acceptance: { status: 'SIGNED', signedAt: acc.signedAt.toISOString() } } as any },
      });
      this.realtime.emitToOrg(acc.organizationId, 'card:updated', { card });
    }
  }
}
```

> **Nota de merge do metadata:** se o `Card.metadata` já carrega outras chaves (ex.: `orderNumber`), fazer merge lendo o metadata atual antes do update, em vez de sobrescrever. Ver como `markWonForConversation` grava `metadata.orderNumber` e replicar o mesmo padrão de merge (spread do metadata existente).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest acceptance-effects.service -c jest.config.js`
Expected: PASS (2 casos).

- [ ] **Step 5: Commit**

```bash
git add src/modules/acceptances/acceptance-effects.service.*
git commit -m "feat(acceptances): efeitos pós-assinatura (SYSTEM msg + selo + realtime)"
```

---

## Task 7: `AcceptancesService.getByToken` + `sign` (TDD)

**Files:**
- Modify: `src/modules/acceptances/acceptances.service.ts`
- Modify: `src/modules/acceptances/acceptances.service.spec.ts`

Regras: `getByToken` → 404 se inexistente, marca `EXPIRED` (soft) e devolve status EXPIRED se `expiresAt` passou. `sign` → só de `PENDING`; expirado/assinado/cancelado lança (Gone/Conflict); grava assinatura, gera PDF, sobe no storage, e chama `effects.onSigned`. É **one-shot** (uma vez SIGNED não reassina).

- [ ] **Step 1: Testes que falham**

```ts
// adicionar em acceptances.service.spec.ts
import { GoneException, NotFoundException } from '@nestjs/common';

describe('AcceptancesService.sign', () => {
  const env = process.env;
  beforeEach(() => { process.env = { ...env, APP_PUBLIC_URL: 'https://x.test' }; });
  afterEach(() => { process.env = env; });

  function baseAcc(over: any = {}) {
    return { id: 'acc-1', organizationId: 'org-1', conversationId: 'conv-1', contactId: 'ct-1',
      cardId: 'card-1', token: 'tok', items: [{ description: 'Ingresso' }], termText: 'Declaro...',
      status: 'PENDING', expiresAt: new Date(Date.now() + 1e9),
      organization: { name: 'OFP' }, ...over };
  }

  it('assina um PENDING: grava nome/ip/ua, gera PDF, sobe no storage e dispara efeitos', async () => {
    const prisma = {
      orderAcceptance: {
        findUnique: jest.fn().mockResolvedValue(baseAcc()),
        update: jest.fn().mockImplementation(({ data }) => ({ ...baseAcc(), ...data, status: 'SIGNED' })),
      },
    } as any;
    const pdf = { render: jest.fn().mockResolvedValue(Buffer.from('pdf')) } as any;
    const storage = { put: jest.fn().mockResolvedValue(undefined) } as any;
    const effects = { onSigned: jest.fn().mockResolvedValue(undefined) } as any;
    const svc = new AcceptancesService(prisma, pdf, effects, storage);

    const res = await svc.sign('tok', { name: 'João', ip: '1.2.3.4', userAgent: 'UA' });
    expect(res.status).toBe('SIGNED');
    expect(prisma.orderAcceptance.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'acc-1' },
      data: expect.objectContaining({ status: 'SIGNED', signerName: 'João', signerIp: '1.2.3.4', signerUserAgent: 'UA' }),
    }));
    expect(pdf.render).toHaveBeenCalled();
    expect(storage.put).toHaveBeenCalledWith(expect.stringContaining('acceptances/'), expect.any(Buffer), 'application/pdf');
    expect(effects.onSigned).toHaveBeenCalled();
  });

  it('token inexistente → NotFound', async () => {
    const prisma = { orderAcceptance: { findUnique: jest.fn().mockResolvedValue(null) } } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any);
    await expect(svc.sign('nope', { name: 'x', ip: '', userAgent: '' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('já assinado → Gone (one-shot)', async () => {
    const prisma = { orderAcceptance: { findUnique: jest.fn().mockResolvedValue(baseAcc({ status: 'SIGNED' })) } } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any);
    await expect(svc.sign('tok', { name: 'x', ip: '', userAgent: '' })).rejects.toBeInstanceOf(GoneException);
  });

  it('expirado → Gone e marca EXPIRED', async () => {
    const prisma = {
      orderAcceptance: {
        findUnique: jest.fn().mockResolvedValue(baseAcc({ expiresAt: new Date(Date.now() - 1000) })),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any);
    await expect(svc.sign('tok', { name: 'x', ip: '', userAgent: '' })).rejects.toBeInstanceOf(GoneException);
    expect(prisma.orderAcceptance.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'EXPIRED' }),
    }));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest acceptances.service -c jest.config.js`
Expected: FAIL — `svc.sign is not a function`.

- [ ] **Step 3: Implementar `getByToken` e `sign` no service**

Adicionar imports no topo: `NotFoundException, GoneException` de `@nestjs/common`. Adicionar métodos:

```ts
  private isExpired(acc: { expiresAt: Date | null }): boolean {
    return !!acc.expiresAt && acc.expiresAt.getTime() < Date.now();
  }

  private pdfUrl(pdfKey: string | null): string | null {
    return pdfKey ? `/api/v1/uploads/${pdfKey}` : null;
  }

  async getByToken(token: string): Promise<PublicAcceptanceView> {
    const acc = await this.prisma.orderAcceptance.findUnique({
      where: { token }, include: { organization: { select: { name: true } } },
    });
    if (!acc) throw new NotFoundException('Aceite não encontrado.');
    let status = acc.status;
    if (status === 'PENDING' && this.isExpired(acc)) {
      status = 'EXPIRED';
      await this.prisma.orderAcceptance.update({ where: { id: acc.id }, data: { status: 'EXPIRED' } });
    }
    return {
      status: status as any,
      organizationName: acc.organization.name,
      items: (acc.items as any) ?? [],
      termText: acc.termText,
      signedAt: acc.signedAt ? acc.signedAt.toISOString() : null,
      signerName: acc.signerName ?? null,
      pdfUrl: this.pdfUrl(acc.pdfKey),
    };
  }

  async sign(token: string, input: { name: string; ip: string; userAgent: string }): Promise<any> {
    const acc = await this.prisma.orderAcceptance.findUnique({
      where: { token }, include: { organization: { select: { name: true } } },
    });
    if (!acc) throw new NotFoundException('Aceite não encontrado.');
    if (acc.status === 'SIGNED') throw new GoneException('Este aceite já foi assinado.');
    if (acc.status === 'CANCELED') throw new GoneException('Este aceite foi cancelado.');
    if (acc.status === 'EXPIRED' || this.isExpired(acc)) {
      if (acc.status !== 'EXPIRED') {
        await this.prisma.orderAcceptance.update({ where: { id: acc.id }, data: { status: 'EXPIRED' } });
      }
      throw new GoneException('O prazo para este aceite expirou. Peça um novo link ao atendente.');
    }

    const signedAt = new Date();
    const pdfBuf = await this.pdf.render({
      organizationName: acc.organization.name,
      termText: acc.termText,
      items: (acc.items as any) ?? [],
      signerName: input.name,
      signedAt,
      signerIp: input.ip,
    });
    const pdfKey = `acceptances/${signedAt.toISOString().slice(0, 10)}/${acc.id}.pdf`;
    await this.storage.put(pdfKey, pdfBuf, 'application/pdf');

    const signed = await this.prisma.orderAcceptance.update({
      where: { id: acc.id },
      data: {
        status: 'SIGNED', signedAt, signerName: input.name,
        signerIp: input.ip || null, signerUserAgent: input.userAgent || null, pdfKey,
      },
    });

    await this.effects.onSigned({
      id: signed.id, organizationId: signed.organizationId, conversationId: signed.conversationId,
      cardId: signed.cardId, signerName: input.name, signedAt,
    });
    return signed;
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest acceptances.service -c jest.config.js`
Expected: PASS (create + sign + getByToken casos).

- [ ] **Step 5: Commit**

```bash
git add src/modules/acceptances/acceptances.service.*
git commit -m "feat(acceptances): getByToken e sign (one-shot, PDF, efeitos)"
```

---

## Task 8: `resend` + `getStatusForConversation`

**Files:**
- Modify: `src/modules/acceptances/acceptances.service.ts`
- Modify: `src/modules/acceptances/acceptances.service.spec.ts`

- [ ] **Step 1: Testes que falham**

```ts
describe('AcceptancesService.resend / status', () => {
  const env = process.env;
  beforeEach(() => { process.env = { ...env, APP_PUBLIC_URL: 'https://x.test' }; });
  afterEach(() => { process.env = env; });

  it('resend renova expiresAt de um PENDING e devolve o link', async () => {
    const prisma = {
      orderAcceptance: {
        findFirst: jest.fn().mockResolvedValue({ id: 'acc-1', token: 'tok', status: 'PENDING', organizationId: 'org-1' }),
        update: jest.fn().mockResolvedValue({ id: 'acc-1', token: 'tok', status: 'PENDING' }),
      },
    } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any);
    const { link } = await svc.resend('org-1', 'acc-1');
    expect(link).toBe('https://x.test/aceite/tok');
    expect(prisma.orderAcceptance.update).toHaveBeenCalled();
  });

  it('status devolve o aceite mais recente da conversa (ou null)', async () => {
    const prisma = { orderAcceptance: { findFirst: jest.fn().mockResolvedValue(null) } } as any;
    const svc = new AcceptancesService(prisma, {} as any, {} as any, {} as any);
    expect(await svc.getStatusForConversation('org-1', 'conv-1')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest acceptances.service -c jest.config.js`
Expected: FAIL — métodos não existem.

- [ ] **Step 3: Implementar**

```ts
  async resend(organizationId: string, id: string): Promise<{ acceptance: any; link: string }> {
    const base = this.baseUrl();
    const acc = await this.prisma.orderAcceptance.findFirst({ where: { id, organizationId } });
    if (!acc) throw new NotFoundException('Aceite não encontrado.');
    if (acc.status === 'SIGNED') throw new GoneException('Este aceite já foi assinado.');
    const expiresAt = new Date(Date.now() + ACCEPTANCE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const updated = await this.prisma.orderAcceptance.update({
      where: { id: acc.id }, data: { status: 'PENDING', expiresAt },
    });
    return { acceptance: updated, link: `${base}/aceite/${acc.token}` };
  }

  async getStatusForConversation(organizationId: string, conversationId: string) {
    const acc = await this.prisma.orderAcceptance.findFirst({
      where: { organizationId, conversationId }, orderBy: { createdAt: 'desc' },
    });
    if (!acc) return null;
    return {
      id: acc.id, status: acc.status, items: acc.items,
      signedAt: acc.signedAt, signerName: acc.signerName,
      signerIp: acc.signerIp, signerUserAgent: acc.signerUserAgent,
      pdfUrl: this.pdfUrl(acc.pdfKey), createdAt: acc.createdAt, expiresAt: acc.expiresAt,
    };
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest acceptances.service -c jest.config.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/acceptances/acceptances.service.*
git commit -m "feat(acceptances): resend e status por conversa"
```

---

## Task 9: Controllers (público + autenticado) e módulo

**Files:**
- Create: `src/modules/acceptances/public-acceptances.controller.ts`
- Create: `src/modules/acceptances/acceptances.controller.ts`
- Create: `src/modules/acceptances/acceptances.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Controller público**

```ts
// public-acceptances.controller.ts
import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators';
import { AcceptancesService } from './acceptances.service';
import { SignAcceptanceDto } from './dto/sign-acceptance.dto';

@Controller('public/acceptances')
export class PublicAcceptancesController {
  constructor(private readonly service: AcceptancesService) {}

  @Public()
  @Get(':token')
  get(@Param('token') token: string) {
    return this.service.getByToken(token);
  }

  @Public()
  @Post(':token/sign')
  sign(@Param('token') token: string, @Body() dto: SignAcceptanceDto, @Req() req: Request) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
      || req.socket?.remoteAddress || '';
    const userAgent = (req.headers['user-agent'] as string) || '';
    return this.service.sign(token, { name: dto.name.trim(), ip, userAgent });
  }
}
```

- [ ] **Step 2: Controller autenticado**

```ts
// acceptances.controller.ts
import { Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentOrg } from '../../common/decorators';
import { AcceptancesService } from './acceptances.service';

@Controller('acceptances')
export class AcceptancesController {
  constructor(private readonly service: AcceptancesService) {}

  @Get('conversation/:conversationId')
  status(@Param('conversationId') conversationId: string, @CurrentOrg('id') orgId: string) {
    return this.service.getStatusForConversation(orgId, conversationId);
  }

  @Post(':id/resend')
  resend(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.resend(orgId, id);
  }
}
```

> Confirmar o import real de `CurrentOrg` (o `pipelines.controller.ts` usa `@CurrentOrg('id') orgId: string` — copiar o mesmo caminho de import).

- [ ] **Step 3: Módulo**

```ts
// acceptances.module.ts
import { Module } from '@nestjs/common';
import { chromium } from 'playwright';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AcceptancesService } from './acceptances.service';
import { AcceptancePdfService } from './acceptance-pdf.service';
import { AcceptanceEffectsService } from './acceptance-effects.service';
import { AcceptancesController } from './acceptances.controller';
import { PublicAcceptancesController } from './public-acceptances.controller';

@Module({
  imports: [PrismaModule, StorageModule, RealtimeModule],
  controllers: [AcceptancesController, PublicAcceptancesController],
  providers: [
    AcceptancesService,
    AcceptanceEffectsService,
    { provide: AcceptancePdfService, useFactory: () => new AcceptancePdfService(chromium) },
  ],
  exports: [AcceptancesService],
})
export class AcceptancesModule {}
```

> Confirmar os nomes reais dos módulos importados (`PrismaModule`, `StorageModule`, `RealtimeModule`) — checar como o `order-ficha.module.ts` importa esses três e espelhar. `RealtimeModule` é `@Global` no projeto (ver memória de realtime), então pode não precisar importar; manter só se o build reclamar do provider.

- [ ] **Step 4: Registrar no app.module**

Em `src/app.module.ts`, adicionar `AcceptancesModule` no array `imports` (junto dos outros feature modules; seguir a ordem alfabética/agrupamento existente).

- [ ] **Step 5: Build + boot (pega ciclo de DI)**

Run:
```bash
npx tsc --noEmit && npx jest -c jest.config.js
```
Expected: compila; testes passam. Se houver spec de guarda de ciclo de DI no projeto (`di-cycle-guard`), rodá-lo também.

- [ ] **Step 6: Commit**

```bash
git add src/modules/acceptances src/app.module.ts
git commit -m "feat(acceptances): controllers público/autenticado + módulo"
```

---

## Task 10: Estender `order-sent` pra gerar o aceite (TDD)

**Files:**
- Modify: `src/modules/pipelines/pipelines.service.ts`
- Modify: `src/modules/pipelines/pipelines.controller.ts`
- Modify: `src/modules/pipelines/pipelines.module.ts` (importar `AcceptancesModule`)
- Test: `src/modules/pipelines/pipelines.order-sent.spec.ts` (estender)

Comportamento: `order-sent` continua movendo o card (legado). Se `withAcceptance !== false` (default true) e vierem `items`, cria o aceite, envia o link no WhatsApp e devolve `{ card, acceptanceLink }`. Se `withAcceptance === false`, comportamento antigo intacto.

- [ ] **Step 1: Teste que falha (estender o spec existente)**

```ts
it('com withAcceptance cria aceite, envia link no WhatsApp e ainda move o card', async () => {
  const created = { acceptance: { id: 'acc-1' }, link: 'https://x.test/aceite/tok' };
  const acceptances = { createForConversation: jest.fn().mockResolvedValue(created) } as any;
  const messages = { send: jest.fn().mockResolvedValue({ id: 'm1' }) } as any;
  // service construído com os novos deps (acceptances, messages) — ajustar o setup do describe
  const res = await service.markOrderSentForConversation('org-1', 'conv-1', 'Pedido enviado', {
    withAcceptance: true, items: [{ description: 'Ingresso' }], createdById: 'user-1',
  });
  expect(acceptances.createForConversation).toHaveBeenCalledWith('org-1', 'conv-1',
    expect.objectContaining({ items: [{ description: 'Ingresso' }], createdById: 'user-1' }));
  expect(messages.send).toHaveBeenCalledWith(
    expect.objectContaining({ conversationId: 'conv-1', type: 'TEXT',
      content: expect.objectContaining({ text: expect.stringContaining('https://x.test/aceite/tok') }) }),
    'user-1', 'org-1');
  expect(res.acceptanceLink).toBe('https://x.test/aceite/tok');
});

it('withAcceptance=false mantém o legado: só move o card, sem aceite', async () => {
  const acceptances = { createForConversation: jest.fn() } as any;
  const res = await service.markOrderSentForConversation('org-1', 'conv-1', 'Pedido enviado', { withAcceptance: false });
  expect(acceptances.createForConversation).not.toHaveBeenCalled();
  expect(res.acceptanceLink).toBeUndefined();
});
```

> No setup do `describe`, injetar os novos deps no construtor do `PipelinesService` (mockados). Ver Step 3 pra a nova assinatura do construtor.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest pipelines.order-sent -c jest.config.js`
Expected: FAIL — assinatura antiga.

- [ ] **Step 3: Implementar no service**

Injetar no construtor do `PipelinesService`: `private readonly acceptances: AcceptancesService` e `private readonly messages: MessagesService`. Alterar a assinatura e o corpo:

```ts
async markOrderSentForConversation(
  organizationId: string,
  conversationId: string,
  stageName: string = ORDER_SENT_STAGE_NAME,
  opts?: { withAcceptance?: boolean; items?: AcceptanceItem[]; termText?: string; createdById?: string },
) {
  // ... (resolução de targetStage + card + moveCard, EXATAMENTE como hoje) ...
  const moved = await this.moveCard(card.id, organizationId, { toStageId: targetStage.id, toIndex: 0 } as MoveCardDto);

  let acceptanceLink: string | undefined;
  if (opts?.withAcceptance !== false && opts?.items && opts.createdById) {
    const { link } = await this.acceptances.createForConversation(organizationId, conversationId, {
      items: opts.items, termText: opts.termText, createdById: opts.createdById,
    });
    acceptanceLink = link;
    const text = `Prontinho! Pra fechar, confira os itens que você recebeu e confirme o aceite neste link:\n${link}`;
    await this.messages.send({ conversationId, type: 'TEXT', content: { text } } as any, opts.createdById, organizationId);
  }
  return { ...(moved as any), acceptanceLink };
}
```

> **Ciclo de DI:** `PipelinesModule` passará a importar `AcceptancesModule` e `MessagingModule` (pro `MessagesService`). Se surgir ciclo (messaging↔pipelines), quebrar com `forwardRef` ou injetar `MessagesService` via `MessagingModule` exportado — checar como outros módulos consomem `MessagesService` hoje e replicar. Rodar o `di-cycle-guard` spec depois.

- [ ] **Step 4: Ajustar o controller**

```ts
@Post('conversations/:conversationId/order-sent')
markOrderSent(
  @Param('conversationId') conversationId: string,
  @CurrentOrg('id') orgId: string,
  @CurrentUser('id') userId: string,
  @Body() body: OrderSentDto,
) {
  return this.service.markOrderSentForConversation(orgId, conversationId, undefined, {
    withAcceptance: body?.withAcceptance,
    items: body?.items,
    termText: body?.termText,
    createdById: userId,
  });
}
```

> Confirmar o decorator real do usuário logado (procurar como outros controllers pegam o `userId` — ex.: `@CurrentUser('id')` ou equivalente) e usar o mesmo.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx jest pipelines -c jest.config.js && npx tsc --noEmit`
Expected: PASS + compila.

- [ ] **Step 6: Commit**

```bash
git add src/modules/pipelines
git commit -m "feat(acceptances): order-sent gera e envia o link de aceite"
```

---

## Task 11: Web — client services + types

**Files:**
- Create: `chat-bullq-web/src/features/acceptances/types.ts`
- Create: `chat-bullq-web/src/features/acceptances/services/acceptances.service.ts`
- Create: `chat-bullq-web/src/features/acceptances/services/public-acceptances.service.ts`
- Modify: `chat-bullq-web/src/features/pipelines/services/pipelines.service.ts`

- [ ] **Step 1: Types**

```ts
// features/acceptances/types.ts
export interface AcceptanceItem { description: string; qty?: number; date?: string; note?: string }
export type AcceptanceStatus = 'PENDING' | 'SIGNED' | 'EXPIRED' | 'CANCELED';

export interface AcceptanceConversationStatus {
  id: string; status: AcceptanceStatus; items: AcceptanceItem[];
  signedAt: string | null; signerName: string | null;
  signerIp: string | null; signerUserAgent: string | null;
  pdfUrl: string | null; createdAt: string; expiresAt: string | null;
}
export interface PublicAcceptanceView {
  status: AcceptanceStatus; organizationName: string; items: AcceptanceItem[];
  termText: string; signedAt: string | null; signerName: string | null; pdfUrl: string | null;
}
```

- [ ] **Step 2: Client autenticado**

Seguir o padrão de `pipelines.service.ts` (usa o `api` client de `src/lib/api.ts`).

```ts
// features/acceptances/services/acceptances.service.ts
import { api } from '@/lib/api';
import type { AcceptanceConversationStatus } from '../types';

export const acceptancesService = {
  async getForConversation(conversationId: string): Promise<AcceptanceConversationStatus | null> {
    const { data } = await api.get(`/acceptances/conversation/${conversationId}`);
    return data ?? null;
  },
  async resend(id: string): Promise<{ link: string }> {
    const { data } = await api.post(`/acceptances/${id}/resend`, {});
    return data;
  },
};
```

- [ ] **Step 3: Client público (sem auth — chama a API pública direto)**

A página pública roda sem sessão. Usar `fetch` direto no base da API (`NEXT_PUBLIC_API_URL`), não o `api` client autenticado.

```ts
// features/acceptances/services/public-acceptances.service.ts
import type { PublicAcceptanceView } from '../types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export const publicAcceptancesService = {
  async get(token: string): Promise<PublicAcceptanceView> {
    const r = await fetch(`${BASE}/public/acceptances/${token}`, { cache: 'no-store' });
    if (!r.ok) throw Object.assign(new Error('not-ok'), { httpStatus: r.status });
    return r.json();
  },
  async sign(token: string, name: string): Promise<PublicAcceptanceView> {
    const r = await fetch(`${BASE}/public/acceptances/${token}/sign`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
    });
    if (!r.ok) throw Object.assign(new Error('sign-failed'), { httpStatus: r.status });
    return r.json();
  },
};
```

> Confirmar o nome real da env do base da API no web (procurar `NEXT_PUBLIC_API_URL` no `src/lib/api.ts` e reutilizar exatamente).

- [ ] **Step 4: `markOrderSent` aceita payload**

Em `features/pipelines/services/pipelines.service.ts`, ampliar:

```ts
async markOrderSent(
  conversationId: string,
  payload?: { withAcceptance?: boolean; items?: { description: string; qty?: number; date?: string; note?: string }[]; termText?: string },
): Promise<{ acceptanceLink?: string }> {
  const { data } = await api.post(`/pipelines/conversations/${conversationId}/order-sent`, payload ?? {});
  return data;
}
```

- [ ] **Step 5: Commit**

```bash
cd chat-bullq-web
git add src/features/acceptances src/features/pipelines/services/pipelines.service.ts
git commit -m "feat(acceptances): client services + types (web)"
```

---

## Task 12: Web — `AcceptanceDialog` no fluxo do order-sent

**Files:**
- Create: `chat-bullq-web/src/features/acceptances/components/acceptance-dialog.tsx`
- Modify: `chat-bullq-web/src/features/inbox/components/chat-input.tsx`

- [ ] **Step 1: Diálogo**

Puxa rascunho da Ficha (`GET /order-ficha/conversation/:id` — reusar o service `order-ficha` existente no web) e deixa editar itens + termo. Ao confirmar, chama `markOrderSent(conversationId, { withAcceptance: true, items, termText })`. Seguir o padrão de dialog do projeto (ex.: `transfer-dialog.tsx` usa o mesmo `Dialog` de UI).

```tsx
// features/acceptances/components/acceptance-dialog.tsx
'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { pipelinesService } from '@/features/pipelines/services/pipelines.service';
import { orderFichaService } from '@/features/order-ficha/services/order-ficha.service';
import type { AcceptanceItem } from '../types';

export function AcceptanceDialog({ conversationId, open, onOpenChange, onDone }: {
  conversationId: string; open: boolean; onOpenChange: (v: boolean) => void; onDone?: () => void;
}) {
  const [items, setItems] = useState<AcceptanceItem[]>([]);
  const [term, setTerm] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    orderFichaService.getForConversation(conversationId)
      .then((f) => setItems((f?.items as AcceptanceItem[]) ?? []))
      .catch(() => setItems([]));
  }, [open, conversationId]);

  const addItem = () => setItems((xs) => [...xs, { description: '' }]);
  const setDesc = (i: number, v: string) => setItems((xs) => xs.map((x, k) => k === i ? { ...x, description: v } : x));
  const removeItem = (i: number) => setItems((xs) => xs.filter((_, k) => k !== i));

  async function submit(withAcceptance: boolean) {
    setSaving(true);
    try {
      const clean = items.filter((x) => x.description.trim());
      const res = await pipelinesService.markOrderSent(conversationId,
        withAcceptance ? { withAcceptance: true, items: clean, termText: term.trim() || undefined } : { withAcceptance: false });
      toast.success(withAcceptance
        ? 'Pedido enviado — link de aceite enviado ao cliente. 🎫'
        : 'Pedido enviado — card movido pra etapa final. 🎫');
      onOpenChange(false); onDone?.();
      return res;
    } catch { toast.error('Não foi possível concluir. Tente de novo.'); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Pedido enviado — solicitar aceite</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Confira os itens entregues. O cliente vai receber um link pra confirmar o recebimento.</p>
        <div className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="flex gap-2">
              <Input value={it.description} placeholder="Ex: Ingresso Disney (2x)" onChange={(e) => setDesc(i, e.target.value)} />
              <Button type="button" variant="ghost" onClick={() => removeItem(i)}>✕</Button>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" onClick={addItem}>+ item</Button>
        </div>
        <Textarea value={term} placeholder="Texto do termo (deixe vazio pro padrão)" onChange={(e) => setTerm(e.target.value)} />
        <div className="flex justify-between gap-2 pt-2">
          <Button variant="ghost" disabled={saving} onClick={() => submit(false)}>Só marcar enviado</Button>
          <Button disabled={saving || items.every((x) => !x.description.trim())} onClick={() => submit(true)}>Gerar aceite e enviar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

> Confirmar os caminhos reais dos componentes de UI (`@/components/ui/*`), do `orderFichaService` e o toast lib (`sonner`) — todos já existem no repo; ajustar imports pro que o projeto usa.

- [ ] **Step 2: Ligar no `chat-input.tsx`**

Substituir o `window.confirm(...)` + `markOrderSent` (linhas ~116-123) por abrir o `AcceptanceDialog`. Adicionar estado `const [acceptOpen, setAcceptOpen] = useState(false)`, trocar o handler do botão pra `setAcceptOpen(true)`, e renderizar `<AcceptanceDialog conversationId={conversationId} open={acceptOpen} onOpenChange={setAcceptOpen} />`.

- [ ] **Step 3: Build**

Run: `cd chat-bullq-web && npx tsc --noEmit`
Expected: compila.

- [ ] **Step 4: Commit**

```bash
git add src/features/acceptances/components/acceptance-dialog.tsx src/features/inbox/components/chat-input.tsx
git commit -m "feat(acceptances): diálogo de aceite no order-sent (web)"
```

---

## Task 13: Web — página pública `/aceite/[token]`

**Files:**
- Create: `chat-bullq-web/src/app/aceite/[token]/page.tsx`

Fora de qualquer grupo autenticado (`(dashboard)`, `(auth)`). Mobile-first. Estados: PENDING → formulário; SIGNED → confirmação + baixar PDF; EXPIRED/CANCELED → aviso.

- [ ] **Step 1: Página**

```tsx
// app/aceite/[token]/page.tsx
'use client';
import { use, useEffect, useState } from 'react';
import { publicAcceptancesService } from '@/features/acceptances/services/public-acceptances.service';
import type { PublicAcceptanceView } from '@/features/acceptances/types';

export default function AcceptancePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [view, setView] = useState<PublicAcceptanceView | null>(null);
  const [name, setName] = useState('');
  const [checked, setChecked] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'signing' | 'error'>('loading');

  useEffect(() => {
    publicAcceptancesService.get(token)
      .then((v) => { setView(v); setState('ready'); })
      .catch(() => setState('error'));
  }, [token]);

  async function sign() {
    setState('signing');
    try { setView(await publicAcceptancesService.sign(token, name.trim())); setState('ready'); }
    catch { setState('error'); }
  }

  if (state === 'loading') return <main className="p-6 max-w-md mx-auto">Carregando…</main>;
  if (state === 'error' || !view) return <main className="p-6 max-w-md mx-auto">Link inválido ou expirado. Peça um novo ao atendente.</main>;

  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';

  return (
    <main className="p-6 max-w-md mx-auto space-y-4">
      <h1 className="text-xl font-semibold">{view.organizationName}</h1>
      {view.status === 'SIGNED' ? (
        <div className="space-y-3">
          <p className="text-green-700 font-medium">✅ Aceite confirmado!</p>
          {view.signerName && <p className="text-sm">Assinado por {view.signerName}.</p>}
          {view.pdfUrl && <a className="underline" href={`${apiBase}${view.pdfUrl}`} target="_blank" rel="noreferrer">Baixar comprovante (PDF)</a>}
        </div>
      ) : view.status !== 'PENDING' ? (
        <p>Este link não está mais disponível. Peça um novo ao atendente.</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{view.termText}</p>
          <ul className="list-disc pl-5 text-sm">
            {view.items.map((it, i) => (
              <li key={i}>{it.description}{it.qty ? ` — ${it.qty}x` : ''}{it.date ? ` (${it.date})` : ''}</li>
            ))}
          </ul>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>Confirmo que conferi os itens acima e está tudo correto.</span>
          </label>
          <input className="w-full border rounded px-3 py-2" placeholder="Seu nome completo" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="w-full bg-black text-white rounded py-2 disabled:opacity-50"
            disabled={!checked || name.trim().length < 2 || state === 'signing'} onClick={sign}>
            {state === 'signing' ? 'Confirmando…' : 'Confirmar aceite'}
          </button>
        </>
      )}
    </main>
  );
}
```

> Estilo mínimo aqui; alinhar com o design system do projeto se quiser (a página é externa, então tailwind puro é aceitável). Confirmar a assinatura de `params` no App Router da versão em uso (Promise vs objeto) e ajustar `use(params)` se necessário.

- [ ] **Step 2: Build**

Run: `cd chat-bullq-web && npx tsc --noEmit && npx next build`
Expected: compila; rota `/aceite/[token]` no output.

- [ ] **Step 3: Commit**

```bash
git add src/app/aceite
git commit -m "feat(acceptances): página pública de assinatura (web)"
```

---

## Task 14: Web — bloco de status no `ClientCardDrawer`

**Files:**
- Create: `chat-bullq-web/src/features/acceptances/components/acceptance-status-block.tsx`
- Modify: `chat-bullq-web/src/features/inbox/components/client-card-drawer.tsx`

- [ ] **Step 1: Bloco**

```tsx
// features/acceptances/components/acceptance-status-block.tsx
'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { acceptancesService } from '../services/acceptances.service';
import type { AcceptanceConversationStatus } from '../types';

const LABEL: Record<string, string> = { PENDING: 'Pendente', SIGNED: 'Assinado', EXPIRED: 'Expirado', CANCELED: 'Cancelado' };
const apiBase = process.env.NEXT_PUBLIC_API_URL ?? '';

export function AcceptanceStatusBlock({ conversationId }: { conversationId: string }) {
  const [acc, setAcc] = useState<AcceptanceConversationStatus | null>(null);
  useEffect(() => { acceptancesService.getForConversation(conversationId).then(setAcc).catch(() => setAcc(null)); }, [conversationId]);
  if (!acc) return null;

  async function resend() {
    try { await acceptancesService.resend(acc!.id); toast.success('Link reenviado.'); }
    catch { toast.error('Falha ao reenviar.'); }
  }

  return (
    <section className="space-y-1 text-sm">
      <h4 className="font-medium">Aceite de entrega</h4>
      <div>Status: <strong>{LABEL[acc.status] ?? acc.status}</strong></div>
      {acc.signedAt && <div>Assinado por {acc.signerName} em {new Date(acc.signedAt).toLocaleString('pt-BR')}</div>}
      {acc.signerIp && <div className="text-xs text-muted-foreground">IP {acc.signerIp}</div>}
      {acc.items?.length > 0 && (
        <ul className="list-disc pl-5 text-xs">{acc.items.map((it, i) => <li key={i}>{it.description}{it.qty ? ` — ${it.qty}x` : ''}</li>)}</ul>
      )}
      <div className="flex gap-3 pt-1">
        {acc.pdfUrl && <a className="underline" href={`${apiBase}${acc.pdfUrl}`} target="_blank" rel="noreferrer">Comprovante PDF</a>}
        {acc.status !== 'SIGNED' && <button className="underline" onClick={resend}>Reenviar link</button>}
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Inserir no drawer**

Em `client-card-drawer.tsx`, renderizar `<AcceptanceStatusBlock conversationId={conversationId} />` numa seção do drawer (perto de "O que pede"/"Negócio"). O drawer já recebe a conversa/contato — passar o `conversationId` disponível no componente.

- [ ] **Step 3: Build**

Run: `cd chat-bullq-web && npx tsc --noEmit`
Expected: compila.

- [ ] **Step 4: Commit**

```bash
git add src/features/acceptances/components/acceptance-status-block.tsx src/features/inbox/components/client-card-drawer.tsx
git commit -m "feat(acceptances): bloco de status do aceite no drawer (web)"
```

---

## Task 15: Smoke E2E manual + finalização

- [ ] **Step 1: Subir API+web local e testar o fluxo feliz**

1. `APP_PUBLIC_URL` setado; API rodando; web rodando.
2. Numa conversa com card, clicar "Pedido enviado" → diálogo abre com itens da Ficha.
3. Confirmar "Gerar aceite e enviar" → card move + mensagem com link chega no chat.
4. Abrir o link (aba anônima) → conferir itens → marcar + digitar nome → Confirmar.
5. Verificar: página mostra "✅ Aceite confirmado" + baixar PDF funciona.
6. No inbox: mensagem SYSTEM apareceu em tempo real; drawer mostra "Assinado" + PDF + IP.
7. Reabrir o link → "não está mais disponível" (one-shot).

- [ ] **Step 2: Rodar suíte completa da API**

Run: `cd chat-bullq-api && npx jest -c jest.config.js && npx tsc --noEmit`
Expected: verde.

- [ ] **Step 3: Abrir PRs**

Seguir a convenção do projeto (deploy via PR, não push direto na branch viva). Abrir PR da API contra `fork/feat/conversation-tabs` e PR do web idem. Body descrevendo a feature + env nova `APP_PUBLIC_URL`.

---

## Self-Review (cobertura do spec)

- **Página web + assinatura** → Task 13. ✅
- **Gatilho no "Pedido enviado"** → Task 10 (order-sent estendido) + Task 12 (diálogo). ✅
- **Itens montados/editados pelo atendente, rascunho da Ficha** → Task 12 (diálogo puxa `order-ficha`). ✅
- **PDF comprovante** → Task 5 (render) + Task 7 (gera no sign, sobe no storage). ✅
- **SYSTEM msg + selo no card** → Task 6. ✅
- **Status no card/drawer** → Task 14. ✅
- **Model + migration aditiva** → Task 1. ✅
- **Endpoints (público + autenticado + order-sent)** → Tasks 9, 10. ✅
- **Multi-tenant / token secreto / one-shot / soft-expire** → Tasks 4, 7 (regras + testes). ✅
- **Validade jurídica (termo + trilha)** → termo default (Task 4) + PDF com IP/UA/data (Task 5). ✅
- **Risco janela 24h/72h** → o envio do link em Task 10 usa `MessagesService.send`, que já passa pelo gate de janela do projeto; fora da janela em canal oficial o envio falha (comportamento conhecido). Sem tratamento extra nesta fatia (documentado no spec). ✅
- **Env `APP_PUBLIC_URL`** → seção Env + validação em `baseUrl()` (Task 4). ✅

**Pontos a confirmar durante a execução (não bloqueiam o plano):** caminhos reais de import (`CurrentOrg`/`CurrentUser`, `PrismaModule`/`StorageModule`/`RealtimeModule`, componentes `@/components/ui/*`, `orderFichaService`, env `NEXT_PUBLIC_API_URL`); possível ciclo de DI ao ligar `MessagesService` no `PipelinesModule` (usar `forwardRef` se necessário, rodar `di-cycle-guard`); merge do `Card.metadata` em vez de sobrescrever.
