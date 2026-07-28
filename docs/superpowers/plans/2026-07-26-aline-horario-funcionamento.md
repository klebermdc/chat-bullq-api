# Horário de funcionamento + Aline fora do horário — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configurar horário de funcionamento geral por org e decidir o que a Aline faz fora dele: não responder, mandar uma mensagem fixa, ou continuar atendendo 24/7 avisando o horário.

**Architecture:** Um campo `Organization.aiOffHoursMode` (`SILENT|MESSAGE|ATTEND`) governa o comportamento fora do `aiBusinessHours` (agenda semanal já configurável na UI). `ATTEND` pula o portão da IA e injeta o horário real + próximo retorno no prompt. `MESSAGE` liga o campo-fantasma `aiOutOfHoursMessage` via um serviço de sistema (senderId null) com dedup por período fechado. `SILENT` = comportamento atual.

**Tech Stack:** NestJS + Prisma 6 (Postgres, multitenant por `organizationId`, sem RLS), BullMQ (fila `outbound-messages`), Next.js (web). Util puro `business-hours.util.ts` já existe.

**Base:** worktree `feat/aline-horario-funcionamento` sobre `fork/feat/conversation-tabs` (API). Web: criar worktree irmão sobre `fork/feat/conversation-tabs` (ver Task 8). Deploy via PR — não push direto. Spec: `docs/superpowers/specs/2026-07-26-aline-horario-funcionamento-design.md`.

---

## File Structure

**API (`chat-bullq-api`):**
- Modify: `prisma/schema.prisma` — `Organization.aiOffHoursMode`, `Conversation.aiOffHoursMessageAt`
- Create: `prisma/migrations/<ts>_add_ai_off_hours_mode/migration.sql`
- Modify: `src/modules/routing/availability/business-hours.util.ts` — nova `formatHoursSummary`
- Modify: `src/modules/routing/availability/business-hours.util.spec.ts`
- Modify: `src/modules/ai-agents/router/agent-router.service.ts:246` — branch ATTEND
- Modify: `src/modules/ai-agents/router/agent-router.service.spec.ts`
- Modify: `src/modules/ai-agents/memory/long-term/long-term.types.ts:90` — tipo `time`
- Modify: `src/modules/ai-agents/memory/long-term/context-enrichment.service.ts` — lê horário real
- Modify: `src/modules/ai-agents/prompts/layers/context.layer.ts` — render + diretiva
- Modify: `src/modules/ai-agents/prompts/layers/context.layer.spec.ts`
- Create: `src/modules/routing/availability/org-off-hours-notice.service.ts` (modo MESSAGE)
- Create: `src/modules/routing/availability/org-off-hours-notice.service.spec.ts`
- Modify: `src/modules/routing/routing.module.ts` — provider+export do serviço novo
- Modify: `src/modules/messaging/pipeline/inbound-message.processor.ts` — hook + ctor
- Modify: `src/modules/messaging/pipeline/inbound-message.observer.spec.ts` — arg posicional
- Modify: `src/modules/organizations/dto/update-organization.dto.ts` — `aiOffHoursMode`

**Web (`chat-bullq-web`):**
- Modify: `src/features/ai-agents/services/ai-settings.service.ts` — tipos load/save
- Modify: `src/app/(dashboard)/settings/ai/page.tsx` — seletor `aiOffHoursMode`

---

## Task 1: Schema + migração (aditivo)

**Files:**
- Modify: `prisma/schema.prisma` (model `Organization` ~linha 145; model `Conversation` ~linha 570)
- Create: `prisma/migrations/<timestamp>_add_ai_off_hours_mode/migration.sql`

- [ ] **Step 1: Adicionar campo em `Organization`**

Em `prisma/schema.prisma`, logo abaixo de `aiOutOfHoursMessage   String?  @map("ai_out_of_hours_message")`:

```prisma
  /// Comportamento da IA fora do `aiBusinessHours`:
  /// SILENT = não responde (default); MESSAGE = envia `aiOutOfHoursMessage` 1x
  /// por período fechado; ATTEND = continua atendendo 24/7 e avisa o horário.
  /// String (não enum Postgres) de propósito — enum + uso na mesma migração
  /// quebra `migrate deploy` (ver fix-cadence-revive-migration-quebrada).
  aiOffHoursMode        String   @default("SILENT") @map("ai_off_hours_mode")
```

- [ ] **Step 2: Adicionar coluna de dedup em `Conversation`**

Em `model Conversation`, ao lado de `offHoursNoticeAt DateTime? @map("off_hours_notice_at")`:

```prisma
  /// Dedup do modo MESSAGE: quando o texto fixo foi enviado nesta conversa.
  /// Coluna própria pra não colidir com `offHoursNoticeAt` (aviso por-atendente).
  aiOffHoursMessageAt DateTime? @map("ai_off_hours_message_at")
```

- [ ] **Step 3: Gerar a migração**

Run: `npx prisma migrate dev --name add_ai_off_hours_mode`
Expected: cria `prisma/migrations/<ts>_add_ai_off_hours_mode/migration.sql` com dois `ALTER TABLE ... ADD COLUMN`; Prisma Client regenerado; sem erro.

- [ ] **Step 4: Conferir o SQL gerado**

Run: `cat prisma/migrations/*add_ai_off_hours_mode/migration.sql`
Expected: `ALTER TABLE "organizations" ADD COLUMN "ai_off_hours_mode" TEXT NOT NULL DEFAULT 'SILENT';` e `ALTER TABLE "conversations" ADD COLUMN "ai_off_hours_message_at" TIMESTAMP(3);`. Nenhum `DROP`/`NOT NULL` sem default.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): aiOffHoursMode + aiOffHoursMessageAt (aditivo)"
```

---

## Task 2: `formatHoursSummary` no util de horário

Frase legível do horário semanal, pra Aline anunciar no modo ATTEND. Ex.: `seg: 09h às 18h; sáb: 09h às 13h`.

**Files:**
- Modify: `src/modules/routing/availability/business-hours.util.ts`
- Test: `src/modules/routing/availability/business-hours.util.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `business-hours.util.spec.ts` (importar `formatHoursSummary` no topo do bloco de imports do util):

```ts
describe('formatHoursSummary', () => {
  it('null quando config é null (24/7)', () => {
    expect(formatHoursSummary(null)).toBeNull();
  });
  it('null quando nenhum dia habilitado', () => {
    expect(formatHoursSummary({ monday: { enabled: false } })).toBeNull();
  });
  it('resume dias habilitados, hora cheia sem minutos', () => {
    const cfg = {
      monday: { enabled: true, windows: [['09:00', '18:00']] as Array<[string, string]> },
      saturday: { enabled: true, windows: [['09:00', '13:30']] as Array<[string, string]> },
      sunday: { enabled: false },
    };
    expect(formatHoursSummary(cfg)).toBe('seg: 09h às 18h; sáb: 09h às 13h30');
  });
  it('dia habilitado sem janelas = o dia todo', () => {
    expect(formatHoursSummary({ tuesday: { enabled: true } })).toBe('ter: o dia todo');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/routing/availability/business-hours.util.spec.ts -t formatHoursSummary`
Expected: FAIL — `formatHoursSummary is not a function`.

- [ ] **Step 3: Implementar**

No fim de `business-hours.util.ts`:

```ts
// "seg: 09h às 18h; sáb: 09h às 13h30". null se nada habilitado.
export function formatHoursSummary(
  config: BusinessHoursConfig | null | undefined,
): string | null {
  if (!config) return null;
  const LABELS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const hhmm = (v: string) => {
    const [h, m] = v.split(':');
    return m === '00' ? `${h}h` : `${h}h${m}`;
  };
  const parts: string[] = [];
  for (let d = 0; d < 7; d++) {
    const day = config[DAY_KEYS[d]];
    if (!day || !day.enabled) continue;
    const windows = day.windows ?? [];
    const w =
      windows.length === 0
        ? 'o dia todo'
        : windows.map(([f, t]) => `${hhmm(f)} às ${hhmm(t)}`).join(' e ');
    parts.push(`${LABELS[d]}: ${w}`);
  }
  return parts.length ? parts.join('; ') : null;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/routing/availability/business-hours.util.spec.ts -t formatHoursSummary`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/routing/availability/business-hours.util.ts src/modules/routing/availability/business-hours.util.spec.ts
git commit -m "feat(availability): formatHoursSummary para anúncio de horário"
```

---

## Task 3: Portão da IA — modo ATTEND roda 24/7

**Files:**
- Modify: `src/modules/ai-agents/router/agent-router.service.ts:246`
- Test: `src/modules/ai-agents/router/agent-router.service.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Em `agent-router.service.spec.ts`, achar como o mock de org é montado (org com `aiBusinessHours` fechado agora). Adicionar dois casos. Usar uma agenda que está SEMPRE fechada (nenhum dia habilitado) pra não depender do relógio:

```ts
it('fora do horário + aiOffHoursMode=ATTEND → handle:true', async () => {
  const org = makeOrg({
    aiEnabled: true,
    aiBusinessHours: { monday: { enabled: false } }, // sempre fechado
    aiOffHoursMode: 'ATTEND',
  });
  // ... montar prisma mock pra retornar esse org + conversation sem override
  const res = await service.decide(/* args do teste existente */);
  expect(res.handle).toBe(true);
});

it('fora do horário + aiOffHoursMode=SILENT → handle:false outside-business-hours', async () => {
  const org = makeOrg({
    aiEnabled: true,
    aiBusinessHours: { monday: { enabled: false } },
    aiOffHoursMode: 'SILENT',
  });
  const res = await service.decide(/* ... */);
  expect(res).toEqual({ handle: false, reason: 'outside-business-hours' });
});
```

> Ajustar `makeOrg`/nome do método (`decide`/`shouldHandle`) ao que o spec já usa. Se não houver helper `makeOrg`, replicar o objeto org inline como os testes vizinhos fazem, incluindo o novo campo `aiOffHoursMode`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/ai-agents/router/agent-router.service.spec.ts -t aiOffHoursMode`
Expected: FAIL — o caso ATTEND retorna `handle:false` (branch ainda não existe).

- [ ] **Step 3: Implementar a branch**

Em `agent-router.service.ts`, trocar o bloco em ~246:

```ts
      if (!this.isWithinBusinessHours(org)) {
        // ATTEND: Aline continua atendendo 24/7 e anuncia o horário no prompt.
        // SILENT/MESSAGE: fica muda (MESSAGE manda o texto fixo via
        // OrgOffHoursNoticeService, fora deste caminho).
        if (org.aiOffHoursMode !== 'ATTEND') {
          return { handle: false, reason: 'outside-business-hours' };
        }
      }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/ai-agents/router/agent-router.service.spec.ts`
Expected: PASS (todos, incluindo os 2 novos).

- [ ] **Step 5: Commit**

```bash
git add src/modules/ai-agents/router/agent-router.service.ts src/modules/ai-agents/router/agent-router.service.spec.ts
git commit -m "feat(ai-router): modo ATTEND mantém IA atendendo fora do horário"
```

---

## Task 4: Enrichment lê o horário real da org

Hoje `context-enrichment` usa 9h–19h chumbado e não carrega a org. Passar a ler `aiBusinessHours`/`aiTimezone` reais e expor resumo + próximo retorno.

**Files:**
- Modify: `src/modules/ai-agents/memory/long-term/long-term.types.ts:90`
- Modify: `src/modules/ai-agents/memory/long-term/context-enrichment.service.ts`
- Test: `src/modules/ai-agents/memory/long-term/context-enrichment.service.spec.ts` (criar se não existir)

- [ ] **Step 1: Estender o tipo `time`**

Em `long-term.types.ts`, substituir o bloco `time`:

```ts
  time: {
    nowIso: string;
    timezone: string;
    businessHours: boolean;
    /** Resumo legível do horário de atendimento (null se 24/7 ou vazio). */
    hoursSummary?: string | null;
    /** Quando um humano retorna, ex "amanhã às 09h" (null se aberto/24-7). */
    nextOpenLabel?: string | null;
  };
```

- [ ] **Step 2: Escrever o teste que falha**

Criar/estender `context-enrichment.service.spec.ts`. Mockar `prisma.conversation.findUnique` pra devolver `organization` com agenda fechada e um `nextOpen` determinístico. Como o cálculo depende de "agora", usar uma agenda com um único dia habilitado e asserir só a forma (não o valor exato do label):

```ts
it('fora do horário: businessHours=false e nextOpenLabel preenchido', async () => {
  prisma.conversation.findUnique.mockResolvedValue({
    id: 'c1', channel: { type: 'WHATSAPP', name: 'x' },
    organization: {
      aiTimezone: 'America/Sao_Paulo',
      aiBusinessHours: { monday: { enabled: true, windows: [['09:00', '18:00']] } },
      aiOffHoursMode: 'ATTEND',
    },
  } as any);
  // contact/messages/mem mocks mínimos...
  const ctx = await service.enrich({ agentId: 'a', conversationId: 'c1', contactId: 'ct' });
  // se rodar dentro de seg 09-18 o teste é frágil; use um fakeTimers fixo:
  // jest.useFakeTimers().setSystemTime(new Date('2026-07-26T03:00:00Z')); // domingo 00h BRT
  expect(typeof ctx.time.businessHours).toBe('boolean');
  expect(ctx.time.hoursSummary).toContain('seg');
});
```

> Preferir `jest.useFakeTimers().setSystemTime(...)` com um instante sabidamente FORA da agenda pra asserir `businessHours=false` e `nextOpenLabel` truthy de forma estável. Restaurar com `jest.useRealTimers()` no `afterEach`.

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx jest src/modules/ai-agents/memory/long-term/context-enrichment.service.spec.ts`
Expected: FAIL — `hoursSummary` undefined (ainda usa o 9-19 chumbado, sem org).

- [ ] **Step 4: Implementar**

Em `context-enrichment.service.ts`:

1. Import no topo:
```ts
import {
  isWithinHours,
  nextOpenAt,
  formatReturn,
  formatHoursSummary,
  type BusinessHoursConfig,
} from '../../../routing/availability/business-hours.util';
```

2. Carregar a org junto da conversa:
```ts
      this.prisma.conversation.findUnique({
        where: { id: input.conversationId },
        include: {
          channel: true,
          organization: {
            select: { aiBusinessHours: true, aiTimezone: true },
          },
        },
      }),
```

3. Trocar o bloco `time`:
```ts
      time: (() => {
        const org = conversation?.organization;
        const tz = org?.aiTimezone || ContextEnrichmentService.DEFAULT_TZ;
        const bh = (org?.aiBusinessHours ?? null) as BusinessHoursConfig | null;
        const now = new Date();
        const open = isWithinHours(bh, tz, now);
        const next = open ? null : nextOpenAt(bh, tz, now);
        return {
          nowIso: now.toISOString(),
          timezone: tz,
          businessHours: open,
          hoursSummary: formatHoursSummary(bh),
          nextOpenLabel: next ? formatReturn(next, tz, now) : null,
        };
      })(),
```

4. Apagar o método privado `isBusinessHours()` (não é mais usado).

- [ ] **Step 5: Rodar e ver passar**

Run: `npx jest src/modules/ai-agents/memory/long-term/context-enrichment.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ai-agents/memory/long-term/long-term.types.ts src/modules/ai-agents/memory/long-term/context-enrichment.service.ts src/modules/ai-agents/memory/long-term/context-enrichment.service.spec.ts
git commit -m "feat(ai-context): enrichment usa horário real da org + próximo retorno"
```

---

## Task 5: Prompt anuncia o horário + diretiva de comportamento

**Files:**
- Modify: `src/modules/ai-agents/prompts/layers/context.layer.ts` (`formatTime`, ~130)
- Test: `src/modules/ai-agents/prompts/layers/context.layer.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Em `context.layer.spec.ts`:

```ts
it('fora do horário: injeta horário, retorno e diretiva de avisar', () => {
  const layer = buildContextLayer({
    // ...campos mínimos que o builder exige (contact/channel/recentMessages)...
    time: {
      nowIso: '2026-07-26T03:00:00.000Z',
      timezone: 'America/Sao_Paulo',
      businessHours: false,
      hoursSummary: 'seg: 09h às 18h',
      nextOpenLabel: 'amanhã às 09h',
    },
  } as any);
  expect(layer.content).toContain('FORA do horário');
  expect(layer.content).toContain('seg: 09h às 18h');
  expect(layer.content).toContain('amanhã às 09h');
  expect(layer.content.toLowerCase()).toContain('avise');
});

it('dentro do horário: texto curto de horário comercial', () => {
  const layer = buildContextLayer({
    time: { nowIso: '2026-07-26T15:00:00.000Z', timezone: 'America/Sao_Paulo', businessHours: true },
  } as any);
  expect(layer.content).toContain('dentro do horário comercial');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/ai-agents/prompts/layers/context.layer.spec.ts`
Expected: FAIL — não contém a diretiva/horário.

- [ ] **Step 3: Implementar `formatTime`**

Substituir o corpo de `formatTime`:

```ts
  private formatTime(time: EnrichedContext['time']): string {
    let humanTime: string;
    try {
      humanTime = new Intl.DateTimeFormat('pt-BR', {
        timeZone: time.timezone,
        dateStyle: 'full',
        timeStyle: 'short',
      }).format(new Date(time.nowIso));
    } catch {
      humanTime = time.nowIso;
    }

    if (time.businessHours) {
      return `Agora: ${humanTime} (${time.timezone}, dentro do horário comercial)`;
    }

    const lines = [
      `Agora: ${humanTime} (${time.timezone}, FORA do horário de atendimento humano)`,
    ];
    if (time.hoursSummary) {
      lines.push(`Horário de atendimento humano: ${time.hoursSummary}.`);
    }
    if (time.nextOpenLabel) {
      lines.push(`Um atendente humano volta a responder ${time.nextOpenLabel}.`);
    }
    lines.push(
      'Como estamos fora do horário: continue qualificando o lead normalmente e, ' +
        'em algum momento natural, avise o horário de atendimento e quando um humano ' +
        'retorna. Nunca invente horários — use só os informados acima.',
    );
    return lines.join('\n');
  }
```

> A diretiva só chega ao modelo quando a Aline roda fora do horário — o que só acontece no modo ATTEND (nos modos SILENT/MESSAGE o portão a mantém muda). Logo não precisa passar `aiOffHoursMode` até aqui.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/ai-agents/prompts/layers/context.layer.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ai-agents/prompts/layers/context.layer.ts src/modules/ai-agents/prompts/layers/context.layer.spec.ts
git commit -m "feat(ai-prompt): anuncia horário e orienta aviso fora do expediente"
```

---

## Task 6: Modo MESSAGE — `OrgOffHoursNoticeService`

Quando a conversa **não tem humano** e a org está em `MESSAGE`, manda `aiOutOfHoursMessage` 1x por período fechado, como mensagem de sistema (senderId null), pela mesma fila de saída da IA.

**Files:**
- Create: `src/modules/routing/availability/org-off-hours-notice.service.ts`
- Test: `src/modules/routing/availability/org-off-hours-notice.service.spec.ts`
- Modify: `src/modules/routing/routing.module.ts`
- Modify: `src/modules/messaging/pipeline/inbound-message.processor.ts`
- Modify: `src/modules/messaging/pipeline/inbound-message.observer.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

`org-off-hours-notice.service.spec.ts`:

```ts
import { OrgOffHoursNoticeService } from './org-off-hours-notice.service';

describe('OrgOffHoursNoticeService', () => {
  const now = new Date('2026-07-26T03:00:00.000Z'); // fora de qualquer 09-18
  const makeConv = (over: any = {}) => ({
    id: 'c1', organizationId: 'o1', channelId: 'ch1', contactId: 'ct1',
    assignedToId: null, aiOffHoursMessageAt: null,
    channel: { id: 'ch1', type: 'WHATSAPP' },
    contact: { id: 'ct1', channels: [{ channelId: 'ch1', externalId: '55119...' }] },
    ...over,
  });
  const makeOrg = (over: any = {}) => ({
    aiOffHoursMode: 'MESSAGE', aiTimezone: 'America/Sao_Paulo',
    aiBusinessHours: { monday: { enabled: true, windows: [['09:00', '18:00']] } },
    aiOutOfHoursMessage: 'Estamos fechados. Voltamos {proximo_horario}.', name: 'OFP',
    ...over,
  });
  let prisma: any, queue: any, realtime: any, svc: OrgOffHoursNoticeService;
  beforeEach(() => {
    prisma = {
      conversation: { findUnique: jest.fn(), update: jest.fn() },
      message: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
      organization: { findUnique: jest.fn() },
    };
    queue = { add: jest.fn() };
    realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn() };
    svc = new OrgOffHoursNoticeService(prisma, realtime, queue);
    (svc as any).clock = () => now;
  });

  it('MESSAGE + fora do horário + sem humano → envia 1x e carimba', async () => {
    prisma.conversation.findUnique.mockResolvedValue(makeConv());
    prisma.organization.findUnique.mockResolvedValue(makeOrg());
    await svc.onInboundReply('c1');
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith('send-outbound', expect.any(Object), expect.any(Object));
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { aiOffHoursMessageAt: now } }),
    );
  });

  it('modo != MESSAGE → no-op', async () => {
    prisma.conversation.findUnique.mockResolvedValue(makeConv());
    prisma.organization.findUnique.mockResolvedValue(makeOrg({ aiOffHoursMode: 'ATTEND' }));
    await svc.onInboundReply('c1');
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('humano já atribuído → no-op (aviso por-atendente cobre)', async () => {
    prisma.conversation.findUnique.mockResolvedValue(makeConv({ assignedToId: 'u1' }));
    prisma.organization.findUnique.mockResolvedValue(makeOrg());
    await svc.onInboundReply('c1');
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('já avisado neste período fechado → no-op', async () => {
    prisma.conversation.findUnique.mockResolvedValue(
      makeConv({ aiOffHoursMessageAt: new Date('2026-07-26T02:00:00.000Z') }),
    );
    prisma.organization.findUnique.mockResolvedValue(makeOrg());
    await svc.onInboundReply('c1');
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('mensagem vazia → no-op', async () => {
    prisma.conversation.findUnique.mockResolvedValue(makeConv());
    prisma.organization.findUnique.mockResolvedValue(makeOrg({ aiOutOfHoursMessage: '   ' }));
    await svc.onInboundReply('c1');
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/routing/availability/org-off-hours-notice.service.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o serviço**

`org-off-hours-notice.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  MessageContentType,
  MessageDirection,
  MessageStatus,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import {
  isWithinHours,
  nextOpenAt,
  previousCloseAt,
  formatReturn,
  type BusinessHoursConfig,
} from './business-hours.util';

/**
 * Modo MESSAGE de `aiOffHoursMode`: manda o texto fixo `aiOutOfHoursMessage`
 * quando o lead escreve FORA do horário e a conversa ainda NÃO tem humano.
 * Envio de sistema (senderId null) pela fila `outbound-messages` — mesmo
 * caminho da IA, então não dispara efeitos de "humano respondeu".
 */
@Injectable()
export class OrgOffHoursNoticeService {
  private readonly logger = new Logger(OrgOffHoursNoticeService.name);
  private clock: () => Date = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    @InjectQueue('outbound-messages') private readonly outboundQueue: Queue,
  ) {}

  async onInboundReply(conversationId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        organizationId: true,
        channelId: true,
        contactId: true,
        assignedToId: true,
        aiOffHoursMessageAt: true,
        contact: { select: { channels: { select: { channelId: true, externalId: true } } } },
      },
    });
    if (!conversation) return;
    if (conversation.assignedToId) return; // humano assumiu → aviso por-atendente cobre

    const org = await this.prisma.organization.findUnique({
      where: { id: conversation.organizationId },
      select: {
        aiOffHoursMode: true,
        aiBusinessHours: true,
        aiTimezone: true,
        aiOutOfHoursMessage: true,
      },
    });
    if (org?.aiOffHoursMode !== 'MESSAGE') return;
    const text0 = (org.aiOutOfHoursMessage ?? '').trim();
    if (!text0) return;

    const config = (org.aiBusinessHours ?? null) as BusinessHoursConfig | null;
    const tz = org.aiTimezone || 'America/Sao_Paulo';
    const now = this.clock();
    if (isWithinHours(config, tz, now)) return; // dentro do horário

    const nextOpen = nextOpenAt(config, tz, now);
    if (!nextOpen) return; // agenda vazia → sem âncora de dedup

    const closedAt = previousCloseAt(config, tz, now);
    if (conversation.aiOffHoursMessageAt && closedAt && conversation.aiOffHoursMessageAt >= closedAt) {
      return; // já avisado neste período fechado
    }

    const externalId = conversation.contact?.channels.find(
      (c) => c.channelId === conversation.channelId,
    )?.externalId;
    if (!externalId) return; // sem endereço no canal → nada a enviar

    const text = text0.replace(/\{proximo_horario\}/g, formatReturn(nextOpen, tz, now));

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: MessageDirection.OUTBOUND,
        type: MessageContentType.TEXT,
        content: { text },
        status: MessageStatus.QUEUED,
        senderName: 'Atendimento',
        metadata: { automated: true, offHoursMessage: true },
      },
    });

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { aiOffHoursMessageAt: now, lastMessageAt: now },
    });

    this.realtime.emitToChannel(conversation.channelId, 'message:new', {
      message,
      conversationId: conversation.id,
      contactId: conversation.contactId,
    });
    this.realtime.emitToConversation(conversation.id, 'message:new', { message });

    await this.outboundQueue.add(
      'send-outbound',
      {
        messageId: message.id,
        channelId: conversation.channelId,
        contactExternalId: externalId,
        message: { type: MessageContentType.TEXT, content: { text } },
      },
      { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: true, removeOnFail: false },
    );
  }
}
```

> Verificar o import de `RealtimeGateway` (o `reply-to-conversation.tool.ts` usa `../../../realtime/realtime.gateway` a partir de `tools/builtin/`; a partir de `routing/availability/` o caminho é `../../realtime/realtime.gateway`). Ajustar se o TS reclamar.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/routing/availability/org-off-hours-notice.service.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Registrar no `routing.module.ts`**

Import + adicionar em `providers` e `exports`:

```ts
import { OrgOffHoursNoticeService } from './availability/org-off-hours-notice.service';
// providers: [ ...existentes, OrgOffHoursNoticeService ]
// exports:   [ ...existentes, OrgOffHoursNoticeService ]
```

Run: `npx tsc --noEmit` → Expected: sem erro de DI/tipos.

- [ ] **Step 6: Injetar e chamar no inbound processor**

Em `inbound-message.processor.ts`:

1. Import:
```ts
import { OrgOffHoursNoticeService } from '../../routing/availability/org-off-hours-notice.service';
```
2. Adicionar no FINAL da lista do construtor (novo parâmetro no fim pra minimizar shift posicional):
```ts
    private readonly orgOffHours: OrgOffHoursNoticeService,
```
3. Logo após o bloco `this.agentAvailability.onInboundReply(...)`:
```ts
        // Fora-de-horário nível org (sem humano): manda a mensagem fixa 1x se
        // aiOffHoursMode=MESSAGE. No-op nos demais modos. Best-effort.
        this.orgOffHours.onInboundReply(conversationId).catch((err) =>
          this.logger.warn(
            `org_off_hours_failed conv=${conversationId}: ${(err as Error).message}`,
          ),
        );
```

- [ ] **Step 7: Corrigir o spec posicional do processor**

Em `inbound-message.observer.spec.ts`, o construtor do `InboundMessageProcessor` é montado por posição. Adicionar um mock `{ onInboundReply: jest.fn() }` na ÚLTIMA posição, correspondendo ao novo parâmetro.

Run: `npx jest src/modules/messaging/pipeline/inbound-message.observer.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/routing/availability/org-off-hours-notice.service.ts src/modules/routing/availability/org-off-hours-notice.service.spec.ts src/modules/routing/routing.module.ts src/modules/messaging/pipeline/inbound-message.processor.ts src/modules/messaging/pipeline/inbound-message.observer.spec.ts
git commit -m "feat(availability): modo MESSAGE envia texto fixo fora do horário (sem humano)"
```

---

## Task 7: DTO da org aceita `aiOffHoursMode`

**Files:**
- Modify: `src/modules/organizations/dto/update-organization.dto.ts` (~linha 46-55)

- [ ] **Step 1: Adicionar o campo ao DTO**

Ao lado de `aiOutOfHoursMessage?: string;`:

```ts
  @ApiPropertyOptional({
    description: 'Comportamento da IA fora do horário: SILENT | MESSAGE | ATTEND.',
    enum: ['SILENT', 'MESSAGE', 'ATTEND'],
  })
  @IsOptional()
  @IsIn(['SILENT', 'MESSAGE', 'ATTEND'])
  aiOffHoursMode?: string;
```

> Garantir imports `IsOptional`, `IsIn` de `class-validator` e `ApiPropertyOptional` de `@nestjs/swagger` (já usados no arquivo). Conferir que o service que aplica o update (`organizations.service.ts`) repassa campos por spread do DTO; se ele faz whitelisting manual como `aiBusinessHours`, adicionar `aiOffHoursMode` do mesmo jeito.

- [ ] **Step 2: Conferir o repasse no service**

Run: `grep -n "aiBusinessHours\|aiOutOfHoursMessage\|aiOffHoursMode" src/modules/organizations/organizations.service.ts`
Expected: se `aiBusinessHours`/`aiOutOfHoursMessage` são copiados explicitamente, adicionar `aiOffHoursMode` na mesma construção do `data`. Se for spread do DTO inteiro, nada a fazer.

- [ ] **Step 3: Build**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/modules/organizations/dto/update-organization.dto.ts src/modules/organizations/organizations.service.ts
git commit -m "feat(org): aceitar aiOffHoursMode no update"
```

---

## Task 8: Web — seletor `aiOffHoursMode`

Criar worktree do web e substituir a seção "Mensagem fora de horário" solta por um seletor de 3 modos; a textarea só aparece no modo MESSAGE.

**Files:**
- Modify: `src/features/ai-agents/services/ai-settings.service.ts`
- Modify: `src/app/(dashboard)/settings/ai/page.tsx`

- [ ] **Step 1: Criar o worktree do web na base certa**

```bash
cd chat-bullq-web
git fetch fork
git worktree add -b feat/aline-horario-funcionamento ../.wt-aline-horario-web fork/feat/conversation-tabs
cd ../.wt-aline-horario-web
```
Expected: worktree criado; `git branch --show-current` = `feat/aline-horario-funcionamento`.

- [ ] **Step 2: Confirmar o estado atual da página**

Run: `grep -n "outOfHoursMessage\|aiOutOfHoursMessage\|alwaysOn\|WEEKDAYS" "src/app/(dashboard)/settings/ai/page.tsx" | head`
Expected: existem `outOfHoursMessage` (state), `aiOutOfHoursMessage` (load/save), `alwaysOn` e o editor `WEEKDAYS`. Se os nomes divergirem, ajustar os passos abaixo aos nomes reais.

- [ ] **Step 3: Tipos no service**

Em `ai-settings.service.ts`, adicionar `aiOffHoursMode` ao tipo de leitura e ao payload de save (ao lado de `aiOutOfHoursMessage`):

```ts
  aiOffHoursMode: 'SILENT' | 'MESSAGE' | 'ATTEND';
```
(e `aiOffHoursMode?: 'SILENT' | 'MESSAGE' | 'ATTEND';` no tipo do update.)

- [ ] **Step 4: Estado + load/save na página**

- Novo estado: `const [offHoursMode, setOffHoursMode] = useState<'SILENT' | 'MESSAGE' | 'ATTEND'>('SILENT');`
- No load (onde faz `setOutOfHoursMessage(data.aiOutOfHoursMessage ?? '')`): `setOffHoursMode(data.aiOffHoursMode ?? 'SILENT');`
- No save (payload): `aiOffHoursMode: offHoursMode,`

- [ ] **Step 5: Substituir a seção "Mensagem fora de horário" pelo seletor**

Trocar todo o `{/* Out of hours message */}` <section> por (renderizar só quando NÃO for 24/7, isto é `!alwaysOn`):

```tsx
{alwaysOn ? null : (
<section className="mt-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
    Fora do horário, a Aline:
  </p>
  <div className="mt-3 space-y-2">
    {([
      ['SILENT', 'Não responde', 'O lead não recebe nada fora do horário.'],
      ['MESSAGE', 'Envia uma mensagem fixa', 'Manda um texto pronto uma vez e não conversa.'],
      ['ATTEND', 'Continua atendendo e avisa o horário', 'A Aline responde 24/7, qualifica e avisa quando a equipe volta.'],
    ] as const).map(([value, label, hint]) => (
      <label key={value} className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-100 bg-zinc-50/40 px-3 py-2 dark:border-zinc-800 dark:bg-zinc-900/40">
        <input
          type="radio"
          name="offHoursMode"
          checked={offHoursMode === value}
          onChange={() => setOffHoursMode(value)}
          className="mt-0.5"
        />
        <span>
          <span className="block text-sm text-zinc-800 dark:text-zinc-200">{label}</span>
          <span className="block text-xs text-zinc-500">{hint}</span>
        </span>
      </label>
    ))}
  </div>

  {offHoursMode === 'MESSAGE' ? (
    <textarea
      value={outOfHoursMessage}
      onChange={(e) => setOutOfHoursMessage(e.target.value)}
      rows={2}
      placeholder="Olá! No momento estamos fora do horário. Voltamos {proximo_horario} e respondemos por aqui."
      className="mt-3 w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
    />
  ) : null}
</section>
)}
```

> `{proximo_horario}` no texto é substituído no backend pelo próximo retorno calculado.

- [ ] **Step 6: Build + lint**

Run: `npm run build` (ou `yarn build`)
Expected: compila sem erro de tipo.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(dashboard)/settings/ai/page.tsx" src/features/ai-agents/services/ai-settings.service.ts
git commit -m "feat(settings): seletor 'fora do horário, a Aline' (SILENT/MESSAGE/ATTEND)"
```

---

## Task 9: Verificação final + E2E manual

- [ ] **Step 1: Suíte da API**

Run (na worktree da API): `npx jest src/modules/routing src/modules/ai-agents`
Expected: PASS.

- [ ] **Step 2: Build API**

Run: `npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 3: Roteiro E2E manual (staging/VPS após deploy)**

- [ ] Org com agenda seg-sex 09-18; agora fora do horário.
- [ ] `aiOffHoursMode=ATTEND`: lead novo escreve → Aline responde, qualifica e cita o horário + próximo retorno.
- [ ] `aiOffHoursMode=MESSAGE` + texto salvo: lead novo (sem humano) escreve → recebe o texto fixo 1x; escreve de novo no mesmo período fechado → NÃO recebe de novo.
- [ ] `aiOffHoursMode=SILENT`: lead escreve fora do horário → silêncio (comportamento atual).
- [ ] Dentro do horário: os três modos respondem normal (Aline atende).
- [ ] Conversa com humano atribuído fora do horário: segue o aviso por-atendente (não o texto org).

- [ ] **Step 4: Deploy**

PR da branch `feat/aline-horario-funcionamento` (API e Web) → `feat/conversation-tabs`. Na VPS: rebuild api+web, `prisma migrate deploy`. Conferir as 2 colunas novas. `git fetch fork` antes de concluir.

---

## Notas de risco

- **Janela vira meia-noite** (`end < start`, ex 22h–02h): tratada como sempre-fechada pelo util (LOW, herdada). Não introduzir agora.
- **Custo LLM**: ATTEND roda à noite → mais chamadas; `aiMonthlyTokenCap` continua como teto (portão intacto).
- **Canal oficial (Meta)**: msgs são resposta a inbound recente → dentro da janela 24h → TEXT livre, sem HSM.
- **Multi-tenant**: default `SILENT` preserva todo tenant existente.
