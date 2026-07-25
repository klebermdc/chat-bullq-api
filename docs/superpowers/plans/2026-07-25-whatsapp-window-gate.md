# WhatsApp Window Gate (24h/72h) + CTWA Counter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop free-form WhatsApp text from being sent to official channels when the messaging window is closed, and make the inbox timer honor the 72h Click-to-WhatsApp (CTWA) window.

**Architecture:** A pure util computes the effective free-form window (`max(lastInboundAt+24h, ctwaClidAt+72h)`, official channels only). A small injectable gate service uses it as a backstop in the single outbound choke point (`OutboundMessageProcessor`), marking blocked messages `FAILED` with a clear reason without throwing (no BullMQ retry). The server exposes a computed `windowExpiresAt` on inbox conversations; the web timer counts down to it.

**Tech Stack:** NestJS + Prisma + BullMQ (API, Jest); Next.js/React (web, no unit runner — verify with `tsc`).

**Spec:** `docs/superpowers/specs/2026-07-25-whatsapp-window-gate-design.md`

**Repos / branches:**
- API: `.wt-lead-lock-api` on branch `feat/whatsapp-window-gate` (already created, off `fork/feat/conversation-tabs`).
- Web: create a worktree `.wt-web-window-gate` on branch `feat/whatsapp-window-gate-web` off `fork/feat/conversation-tabs` (Task 6 setup step).

All API paths are relative to the API worktree root; all web paths to `chat-bullq-web` (or its worktree).

---

## Task 1: Pure window util

**Files:**
- Create: `src/modules/messaging/conversations/whatsapp-window.util.ts`
- Test: `src/modules/messaging/conversations/whatsapp-window.util.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `whatsapp-window.util.spec.ts`:
```ts
import { computeWhatsappWindow } from './whatsapp-window.util';

const H = 60 * 60 * 1000;
const base = new Date('2026-07-25T12:00:00.000Z');
const at = (hoursAgo: number) => new Date(base.getTime() - hoursAgo * H);

describe('computeWhatsappWindow', () => {
  it('canal não-oficial → não aplicável e sempre aberto', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_WASENDER',
      lastInboundAt: at(100),
      ctwaClidAt: null,
      now: base,
    });
    expect(w).toEqual({ applicable: false, open: true, expiresAt: null, kind: null });
  });

  it('oficial, sem inbound e sem ctwa → fechado (só template abre a 1ª msg)', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: null,
      ctwaClidAt: null,
      now: base,
    });
    expect(w.applicable).toBe(true);
    expect(w.open).toBe(false);
    expect(w.expiresAt).toBeNull();
  });

  it('CSW 24h: inbound há 10h → aberto, kind csw24', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(10),
      ctwaClidAt: null,
      now: base,
    });
    expect(w.open).toBe(true);
    expect(w.kind).toBe('csw24');
    expect(w.expiresAt!.getTime()).toBe(at(10).getTime() + 24 * H);
  });

  it('CSW 24h: inbound há 25h → fechado', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(25),
      ctwaClidAt: null,
      now: base,
    });
    expect(w.open).toBe(false);
  });

  it('CTWA 72h: clique há 30h, inbound há 25h → aberto pela regra ctwa72', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(25), // CSW já fechou
      ctwaClidAt: at(30), // dentro das 72h
      now: base,
    });
    expect(w.open).toBe(true);
    expect(w.kind).toBe('ctwa72');
    expect(w.expiresAt!.getTime()).toBe(at(30).getTime() + 72 * H);
  });

  it('usa a MAIOR das duas janelas (reply recente estende além das 72h da entrada)', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(1), // CSW até base+23h
      ctwaClidAt: at(71), // ctwa até base+1h
      now: base,
    });
    expect(w.kind).toBe('csw24');
    expect(w.expiresAt!.getTime()).toBe(at(1).getTime() + 24 * H);
  });

  it('CTWA há 80h e sem inbound → fechado', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: null,
      ctwaClidAt: at(80),
      now: base,
    });
    expect(w.open).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/messaging/conversations/whatsapp-window.util.spec.ts`
Expected: FAIL — "Cannot find module './whatsapp-window.util'".

- [ ] **Step 3: Write minimal implementation**

Create `whatsapp-window.util.ts`:
```ts
const HOUR_MS = 60 * 60 * 1000;
export const CSW_WINDOW_MS = 24 * HOUR_MS;
export const CTWA_WINDOW_MS = 72 * HOUR_MS;

export interface WhatsappWindowInput {
  channelType: string;
  lastInboundAt: Date | null;
  ctwaClidAt: Date | null;
  now: Date;
}

export interface WhatsappWindowState {
  /** true só para WHATSAPP_OFFICIAL — os demais canais não têm a regra da Meta. */
  applicable: boolean;
  /** Pode enviar texto livre agora? (não-aplicável ⇒ sempre true) */
  open: boolean;
  /** Quando a janela de texto livre fecha. null quando não aplicável ou nunca abriu. */
  expiresAt: Date | null;
  /** Qual regra deu a janela vigente. */
  kind: 'csw24' | 'ctwa72' | null;
}

/**
 * Janela efetiva de texto livre = max(lastInboundAt+24h, ctwaClidAt+72h).
 * Só vale para o canal oficial (Meta). Sem timestamps ⇒ fechada (a 1ª msg
 * de uma conversa oficial exige template).
 */
export function computeWhatsappWindow(
  input: WhatsappWindowInput,
): WhatsappWindowState {
  if (input.channelType !== 'WHATSAPP_OFFICIAL') {
    return { applicable: false, open: true, expiresAt: null, kind: null };
  }
  const csw = input.lastInboundAt
    ? input.lastInboundAt.getTime() + CSW_WINDOW_MS
    : null;
  const ctwa = input.ctwaClidAt
    ? input.ctwaClidAt.getTime() + CTWA_WINDOW_MS
    : null;

  let expMs: number | null = null;
  let kind: 'csw24' | 'ctwa72' | null = null;
  if (csw !== null) {
    expMs = csw;
    kind = 'csw24';
  }
  if (ctwa !== null && (expMs === null || ctwa > expMs)) {
    expMs = ctwa;
    kind = 'ctwa72';
  }
  if (expMs === null) {
    return { applicable: true, open: false, expiresAt: null, kind: null };
  }
  return {
    applicable: true,
    open: input.now.getTime() < expMs,
    expiresAt: new Date(expMs),
    kind,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/messaging/conversations/whatsapp-window.util.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/messaging/conversations/whatsapp-window.util.ts src/modules/messaging/conversations/whatsapp-window.util.spec.ts
git commit -m "feat(window): util puro de janela 24h/72h (CSW + CTWA)"
```

---

## Task 2: `WhatsappWindowGate` service (backstop decision + marking)

Isolates the "should this send be blocked, and if so mark it FAILED" logic so it's unit-testable without constructing the full BullMQ processor.

**Files:**
- Create: `src/modules/messaging/pipeline/whatsapp-window-gate.service.ts`
- Test: `src/modules/messaging/pipeline/whatsapp-window-gate.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `whatsapp-window-gate.service.spec.ts`:
```ts
import { WhatsappWindowGate } from './whatsapp-window-gate.service';
import { MessageContentType, MessageStatus } from '@prisma/client';

function make(convo: {
  lastInboundAt: Date | null;
  ctwaClidAt: Date | null;
}) {
  const prisma = {
    message: {
      findUnique: jest.fn().mockResolvedValue({
        conversationId: 'conv1',
        conversation: {
          lastInboundAt: convo.lastInboundAt,
          contact: { ctwaClidAt: convo.ctwaClidAt },
        },
      }),
      update: jest.fn().mockResolvedValue({ id: 'msg1', conversationId: 'conv1' }),
    },
  } as any;
  const realtime = { emitToConversation: jest.fn() } as any;
  return { gate: new WhatsappWindowGate(prisma, realtime), prisma, realtime };
}

const now = new Date('2026-07-25T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

describe('WhatsappWindowGate.blockIfClosed', () => {
  it('texto livre + janela fechada + oficial → bloqueia (marca FAILED, sem enviar)', async () => {
    const { gate, prisma, realtime } = make({ lastInboundAt: hoursAgo(30), ctwaClidAt: null });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'WHATSAPP_OFFICIAL',
      messageType: MessageContentType.TEXT,
      now,
    });
    expect(blocked).toBe(true);
    expect(prisma.message.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'msg1' },
        data: expect.objectContaining({ status: MessageStatus.FAILED }),
      }),
    );
    expect(realtime.emitToConversation).toHaveBeenCalled();
  });

  it('template → nunca bloqueia (não consulta janela)', async () => {
    const { gate, prisma } = make({ lastInboundAt: hoursAgo(30), ctwaClidAt: null });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'WHATSAPP_OFFICIAL',
      messageType: MessageContentType.TEMPLATE,
      now,
    });
    expect(blocked).toBe(false);
    expect(prisma.message.findUnique).not.toHaveBeenCalled();
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('canal não-oficial → nunca bloqueia', async () => {
    const { gate, prisma } = make({ lastInboundAt: hoursAgo(30), ctwaClidAt: null });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'WHATSAPP_WASENDER',
      messageType: MessageContentType.TEXT,
      now,
    });
    expect(blocked).toBe(false);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('CTWA dentro de 72h (CSW fechada) → NÃO bloqueia', async () => {
    const { gate, prisma } = make({ lastInboundAt: hoursAgo(30), ctwaClidAt: hoursAgo(40) });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'WHATSAPP_OFFICIAL',
      messageType: MessageContentType.TEXT,
      now,
    });
    expect(blocked).toBe(false);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  it('janela aberta (inbound recente) → NÃO bloqueia', async () => {
    const { gate } = make({ lastInboundAt: hoursAgo(1), ctwaClidAt: null });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'WHATSAPP_OFFICIAL',
      messageType: MessageContentType.TEXT,
      now,
    });
    expect(blocked).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/messaging/pipeline/whatsapp-window-gate.service.spec.ts`
Expected: FAIL — "Cannot find module './whatsapp-window-gate.service'".

- [ ] **Step 3: Write minimal implementation**

Create `whatsapp-window-gate.service.ts`:
```ts
import { Injectable, Logger } from '@nestjs/common';
import { MessageContentType, MessageStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { computeWhatsappWindow } from '../conversations/whatsapp-window.util';

const BLOCK_REASON =
  'Janela de atendimento (24h/72h) fechada — envie um template aprovado.';

@Injectable()
export class WhatsappWindowGate {
  private readonly logger = new Logger(WhatsappWindowGate.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * Backstop: se um envio de TEXTO LIVRE cai fora da janela num canal oficial,
   * marca a mensagem como FAILED com motivo claro e retorna true (o chamador
   * NÃO deve enviar nem re-tentar). Template / canal não-oficial / janela
   * aberta ⇒ retorna false (segue o fluxo normal).
   */
  async blockIfClosed(params: {
    messageId: string;
    channelType: string;
    messageType: MessageContentType;
    now?: Date;
  }): Promise<boolean> {
    // Template é o único permitido fora da janela — nunca gateia.
    if (params.messageType === MessageContentType.TEMPLATE) return false;
    // Regra só existe no canal oficial da Meta.
    if (params.channelType !== 'WHATSAPP_OFFICIAL') return false;

    const msg = await this.prisma.message.findUnique({
      where: { id: params.messageId },
      select: {
        conversationId: true,
        conversation: {
          select: {
            lastInboundAt: true,
            contact: { select: { ctwaClidAt: true } },
          },
        },
      },
    });
    if (!msg?.conversation) return false; // sem contexto → não arrisca bloquear

    const window = computeWhatsappWindow({
      channelType: params.channelType,
      lastInboundAt: msg.conversation.lastInboundAt ?? null,
      ctwaClidAt: msg.conversation.contact?.ctwaClidAt ?? null,
      now: params.now ?? new Date(),
    });
    if (window.open) return false;

    const updated = await this.prisma.message.update({
      where: { id: params.messageId },
      data: { status: MessageStatus.FAILED, failedReason: BLOCK_REASON },
      select: { id: true, conversationId: true },
    });
    this.realtime.emitToConversation(updated.conversationId, 'message:status', {
      messageId: updated.id,
      status: MessageStatus.FAILED,
      conversationId: updated.conversationId,
    });
    this.logger.warn(
      `outbound_window_closed msg=${params.messageId} type=${params.messageType}`,
    );
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/messaging/pipeline/whatsapp-window-gate.service.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/messaging/pipeline/whatsapp-window-gate.service.ts src/modules/messaging/pipeline/whatsapp-window-gate.service.spec.ts
git commit -m "feat(window): WhatsappWindowGate — backstop de janela no envio"
```

---

## Task 3: Wire the gate into `OutboundMessageProcessor` + register in module

**Files:**
- Modify: `src/modules/messaging/pipeline/outbound-message.processor.ts` (constructor + early in `process`)
- Modify: the module that provides `OutboundMessageProcessor` (find with grep in Step 1) — add `WhatsappWindowGate` to `providers`.

- [ ] **Step 1: Find the module that declares the processor**

Run: `grep -rln "OutboundMessageProcessor" src/modules/messaging --include=*.module.ts`
Note the file (expected: `src/modules/messaging/messaging.module.ts` or a pipeline sub-module). Open it; you will add `WhatsappWindowGate` to its `providers` array in Step 4.

- [ ] **Step 2: Inject the gate + call it before send**

In `outbound-message.processor.ts`, add the import near the other imports:
```ts
import { WhatsappWindowGate } from './whatsapp-window-gate.service';
```
Add the dependency to the constructor (after the existing params, keeping `cadenceRunner` last is fine — add before it or after; place after `idempotency`):
```ts
    private readonly idempotency: IdempotencyService,
    private readonly windowGate: WhatsappWindowGate,
    @Inject(forwardRef(() => CadenceRunner))
    private readonly cadenceRunner: CadenceRunner,
```
Then, inside `process`, right after `const adapter = this.adapterRegistry.getOutbound(channel.type);` and BEFORE `simulateTypingIfAiMessage`, insert:
```ts
    // Backstop de janela: não deixa texto livre sair fora das 24h/72h num
    // canal oficial (a Meta rejeitaria com 131047). Marca a msg e encerra o
    // job com SUCESSO — janela fechada não é transitório, não re-tentar.
    const blocked = await this.windowGate.blockIfClosed({
      messageId,
      channelType: channel.type,
      messageType: message.type,
      now: new Date(),
    });
    if (blocked) {
      return { success: false, skipped: 'window_closed' };
    }
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: 0 errors. (If Prisma-client-skew errors about unrelated fields appear, run `npx prisma generate` first, then re-run.)

- [ ] **Step 4: Register the provider**

In the module found in Step 1, add to `providers`:
```ts
    WhatsappWindowGate,
```
And add the import at the top:
```ts
import { WhatsappWindowGate } from './pipeline/whatsapp-window-gate.service';
```
(adjust the relative path to match the module's location).

- [ ] **Step 5: Run the full messaging + pipeline suites**

Run: `npx jest src/modules/messaging`
Expected: PASS (all existing + the new gate/util specs). If a DI/boot spec constructs the processor, it now needs `WhatsappWindowGate` — the provider registration in Step 4 covers app wiring; unit specs that `new OutboundMessageProcessor(...)` directly must pass a mock gate `{ blockIfClosed: jest.fn().mockResolvedValue(false) }`. Fix any such spec by adding that mock arg in the same constructor position.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(window): gate de janela no OutboundMessageProcessor (choke point único)"
```

---

## Task 4: Expose computed `windowExpiresAt` on inbox conversations

**Files:**
- Create: `src/modules/messaging/conversations/attach-window-expiry.ts` (pure helper)
- Test: `src/modules/messaging/conversations/attach-window-expiry.spec.ts`
- Modify: `src/modules/messaging/conversations/conversations.repository.ts` (contact select + map)

- [ ] **Step 1: Write the failing test for the pure helper**

Create `attach-window-expiry.spec.ts`:
```ts
import { attachWindowExpiry } from './attach-window-expiry';

const now = new Date('2026-07-25T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

describe('attachWindowExpiry', () => {
  it('anexa windowExpiresAt (ISO) e windowKind para canal oficial', () => {
    const out = attachWindowExpiry(
      {
        id: 'c1',
        lastInboundAt: hoursAgo(1),
        channel: { type: 'WHATSAPP_OFFICIAL' },
        contact: { ctwaClidAt: null },
      },
      now,
    );
    expect(out.windowKind).toBe('csw24');
    expect(out.windowExpiresAt).toBe(
      new Date(hoursAgo(1).getTime() + 24 * 3600_000).toISOString(),
    );
  });

  it('CTWA estende para 72h', () => {
    const out = attachWindowExpiry(
      {
        id: 'c1',
        lastInboundAt: hoursAgo(30),
        channel: { type: 'WHATSAPP_OFFICIAL' },
        contact: { ctwaClidAt: hoursAgo(40) },
      },
      now,
    );
    expect(out.windowKind).toBe('ctwa72');
    expect(out.windowExpiresAt).toBe(
      new Date(hoursAgo(40).getTime() + 72 * 3600_000).toISOString(),
    );
  });

  it('canal não-oficial → windowExpiresAt null', () => {
    const out = attachWindowExpiry(
      {
        id: 'c1',
        lastInboundAt: hoursAgo(1),
        channel: { type: 'WHATSAPP_WASENDER' },
        contact: { ctwaClidAt: null },
      },
      now,
    );
    expect(out.windowExpiresAt).toBeNull();
    expect(out.windowKind).toBeNull();
  });

  it('preserva os campos originais da conversa', () => {
    const conv = {
      id: 'c1',
      lastInboundAt: null,
      channel: { type: 'WHATSAPP_WASENDER' },
      contact: { ctwaClidAt: null },
      unreadCount: 3,
    };
    const out = attachWindowExpiry(conv, now);
    expect(out.id).toBe('c1');
    expect((out as any).unreadCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/messaging/conversations/attach-window-expiry.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

Create `attach-window-expiry.ts`:
```ts
import { computeWhatsappWindow } from './whatsapp-window.util';

/** Forma mínima que o helper lê da conversa carregada. */
export interface WindowSource {
  lastInboundAt: Date | null;
  channel?: { type: string } | null;
  contact?: { ctwaClidAt: Date | null } | null;
}

/**
 * Anexa `windowExpiresAt` (ISO string | null) e `windowKind` à conversa,
 * computados no servidor (fonte única). Não muta o objeto original.
 */
export function attachWindowExpiry<T extends WindowSource>(
  conversation: T,
  now: Date = new Date(),
): T & { windowExpiresAt: string | null; windowKind: 'csw24' | 'ctwa72' | null } {
  const w = computeWhatsappWindow({
    channelType: conversation.channel?.type ?? '',
    lastInboundAt: conversation.lastInboundAt ?? null,
    ctwaClidAt: conversation.contact?.ctwaClidAt ?? null,
    now,
  });
  return {
    ...conversation,
    windowExpiresAt: w.expiresAt ? w.expiresAt.toISOString() : null,
    windowKind: w.kind,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/modules/messaging/conversations/attach-window-expiry.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire into the repository**

In `conversations.repository.ts`, in the `findInbox` include block, the `contact` uses `select`. Add `ctwaClidAt` to that select. Find (around line 249-260):
```ts
          contact: {
            select: {
```
and add `ctwaClidAt: true,` among the contact's selected scalar fields (next to `id`/`name`/`phone`).

Then, at the top of the file add:
```ts
import { attachWindowExpiry } from './attach-window-expiry';
```
Finally, change the return of `findInbox`. Currently:
```ts
    return { conversations: enriched, total };
```
Replace with:
```ts
    const now = new Date();
    return {
      conversations: enriched.map((c) => attachWindowExpiry(c as any, now)),
      total,
    };
```
(`channel.type` is already selected at line ~261-263; `lastInboundAt` is a Conversation scalar returned by default since `findInbox` uses `include`, not a top-level `select`.)

- [ ] **Step 6: Verify + run conversations suite**

Run: `npx tsc --noEmit && npx jest src/modules/messaging/conversations`
Expected: 0 tsc errors; all conversation specs PASS. (Run `npx prisma generate` first if Prisma-skew errors appear.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(window): expõe windowExpiresAt/windowKind computado nas conversas do inbox"
```

---

## Task 5: API — final full-suite check + push + PR

- [ ] **Step 1: Regenerate client + typecheck + full suite**

Run: `npx prisma generate && npx tsc --noEmit && npx jest`
Expected: 0 tsc errors; all suites PASS except the pre-existing DB-integration specs (`*.integration.spec.ts`) which need a live Postgres — those failures are environmental and unrelated.

- [ ] **Step 2: Push + open PR**

```bash
git push -u fork feat/whatsapp-window-gate
gh pr create --repo klebermdc/chat-bullq-api --base feat/conversation-tabs \
  --head feat/whatsapp-window-gate \
  --title "feat(window): gate de janela 24h/72h + windowExpiresAt (CTWA-aware)" \
  --body "Implementa o achado B da auditoria. Backstop no OutboundMessageProcessor (texto livre fora da janela em canal oficial → FAILED com motivo, sem 131047, sem retry); util puro 24h/72h; expõe windowExpiresAt nas conversas do inbox. Spec: docs/superpowers/specs/2026-07-25-whatsapp-window-gate-design.md. Sentinela de deploy: computeWhatsappWindow."
```

---

## Task 6: Web — inbox timer consumes `windowExpiresAt` (72h-aware)

No unit runner in the web repo — verify with `tsc`. Keep `computeWindowState` pure and trivially correct.

**Files:**
- Modify: `src/features/inbox/lib/window-state.ts`
- Modify: `src/features/inbox/services/inbox.service.ts` (Conversation type)
- Modify: `src/features/inbox/components/chat-panel.tsx:460-464` (call site)

- [ ] **Step 1: Create the web worktree**

```bash
cd "/Users/kleber/Desktop/agent-browser-0.2.0 2/Teste.md/Chat OFP"
git -C chat-bullq-web fetch fork -q
git -C chat-bullq-web worktree add ".wt-web-window-gate" -b feat/whatsapp-window-gate-web fork/feat/conversation-tabs
cd .wt-web-window-gate && yarn install --frozen-lockfile
```

- [ ] **Step 2: Add `windowExpiresAt` to the Conversation type**

In `src/features/inbox/services/inbox.service.ts`, inside `export interface Conversation {` (line ~63), add:
```ts
  windowExpiresAt?: string | null;
  windowKind?: 'csw24' | 'ctwa72' | null;
```

- [ ] **Step 3: Update `computeWindowState` to prefer the server value**

Replace the body of `computeWindowState` in `src/features/inbox/lib/window-state.ts` with:
```ts
export function computeWindowState(opts: {
  channelType?: string;
  lastInboundAt?: string | null;
  windowExpiresAt?: string | null; // servidor (preferido) — já cobre 24h/72h CTWA
  windowKind?: 'csw24' | 'ctwa72' | null;
  now: number;
}): WindowState {
  const applicable = opts.channelType === 'WHATSAPP_OFFICIAL';
  if (!applicable) {
    return { applicable, open: false, closed: false, msLeft: 0, expiresAt: null };
  }
  // Preferir a expiração computada no servidor (cobre a janela de 72h de CTWA).
  // Fallback: cálculo antigo de 24h a partir do último inbound (cache velho).
  const expiresAt = opts.windowExpiresAt
    ? new Date(opts.windowExpiresAt).getTime()
    : opts.lastInboundAt
      ? new Date(opts.lastInboundAt).getTime() + WINDOW_MS
      : null;
  if (expiresAt === null) {
    return { applicable, open: false, closed: false, msLeft: 0, expiresAt: null };
  }
  const msLeft = expiresAt - opts.now;
  return {
    applicable,
    open: msLeft > 0,
    closed: msLeft <= 0,
    msLeft: Math.max(0, msLeft),
    expiresAt,
  };
}
```
(Keep `WINDOW_MS`, `WindowState`, `lastInboundAt`, `formatMsLeft` as-is.)

- [ ] **Step 4: Pass the server value at the call site**

In `src/features/inbox/components/chat-panel.tsx`, change the `computeWindowState` call (lines 460-464) to:
```ts
  const windowState = computeWindowState({
    channelType: conversation.channel?.type,
    lastInboundAt: lastInboundAt(messages),
    windowExpiresAt: conversation.windowExpiresAt,
    windowKind: conversation.windowKind,
    now,
  });
```

- [ ] **Step 5: Verify types + lint**

Run: `npx tsc --noEmit && yarn lint`
Expected: 0 type errors; lint clean.

- [ ] **Step 6: Commit + push + PR**

```bash
git add -A
git commit -m "feat(window): timer do inbox usa windowExpiresAt do servidor (72h CTWA-aware)"
git push -u fork feat/whatsapp-window-gate-web
gh pr create --repo klebermdc/chat-bullq-web --base feat/conversation-tabs \
  --head feat/whatsapp-window-gate-web \
  --title "feat(window): timer do inbox 72h-aware (CTWA) via windowExpiresAt" \
  --body "Consome windowExpiresAt/windowKind do servidor no computeWindowState; fallback 24h para cache antigo. Destrava o compositor para leads de anúncio (72h). Par do PR da API feat/whatsapp-window-gate."
```

---

## Task 7 (optional polish): chip label "72h · anúncio"

Only if desired. In `conversation-header.tsx` `WindowChip`, when `windowState` carries `windowKind === 'ctwa72'`, append a small "· anúncio" suffix to the countdown label. Requires threading `windowKind` into `WindowState` (add `kind?: 'csw24'|'ctwa72'|null` to the web `WindowState` interface and set it in `computeWindowState`). Skip unless explicitly requested.

---

## Notes for the executor
- **Prisma client skew:** this repo's generated client can lag the branch schema. If `tsc` reports errors about unrelated fields (e.g. `requireAiParked`), run `npx prisma generate` and re-check — it is not your change.
- **Deploy:** API via `deploy-safe.sh` with `API_SENTINEL="computeWhatsappWindow"` (unique symbol, survives compilation). Web rides the next web deploy (or deploy explicitly). Do NOT push directly to `feat/conversation-tabs` — PR + merge + `deploy-safe.sh`.
- **Do not throw for a closed window** — marking + return is deliberate so BullMQ does not retry a permanently-closed window.
