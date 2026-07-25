# Reengajamento apenas para leads "parados na IA" — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Escopar os dois motores de reengajamento (Inatividade `AUTO_REENGAGE` e Cadência `NO_REPLY`) para só reengajar leads parados na fase da IA (sem humano E IA ativa), com toggle no menu (default OFF) no Motor A, e corte no envio quando um humano assume no meio.

**Architecture:** Flag `requireAiParked` gravado em cada `ScheduledMessage` faz o `ScheduledDispatchProcessor` (ponto único por onde os dois motores despacham) revalidar `isAiParked` antes de enviar e cancelar se um humano assumiu. Motor A ganha `InactivitySettings.reengageOnlyAiParked` (toggle default false) que decide inscrever e grava o flag; Motor B aplica direto (sem toggle) porque é dormant e inerentemente pré-humano.

**Tech Stack:** NestJS + Prisma 6 + Postgres (API), Next.js + React Query (Web), Jest.

**Definição central** (`isAiParked`): `assignedToId == null && awaitingHumanReply == false && aiEnabled !== false`.

**Worktrees:**
- API: `.wt-reengage-ai-parked` (branch `feat/reengage-only-ai-parked`, base `fork/feat/conversation-tabs`). Já criado.
- Web: criar na Task 8.

---

### Task 1: Migração aditiva + schema Prisma

**Files:**
- Modify: `prisma/schema.prisma` (model `InactivitySettings` ~2021; model `ScheduledMessage` ~1975)
- Create: `prisma/migrations/20260725120000_reengage_only_ai_parked/migration.sql`

- [ ] **Step 1: Adicionar campo em `InactivitySettings`**

Em `model InactivitySettings`, após `quietHoursEnd Int? @map("quiet_hours_end")`:

```prisma
  reengageOnlyAiParked Boolean @default(false) @map("reengage_only_ai_parked")
```

- [ ] **Step 2: Adicionar campo em `ScheduledMessage`**

Em `model ScheduledMessage`, logo após `cancelOnReply Boolean @default(false) @map("cancel_on_reply")`:

```prisma
  requireAiParked Boolean @default(false) @map("require_ai_parked")
```

- [ ] **Step 3: Escrever a migração SQL**

Criar `prisma/migrations/20260725120000_reengage_only_ai_parked/migration.sql`:

```sql
-- Reengajamento só para leads "parados na IA" (fase Aline).
-- Aditivo puro (NOT NULL DEFAULT false) → seguro para migrate deploy no boot.

ALTER TABLE "inactivity_settings"
  ADD COLUMN "reengage_only_ai_parked" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "scheduled_messages"
  ADD COLUMN "require_ai_parked" BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 4: Regenerar o Prisma Client**

Run: `npx prisma generate`
Expected: "Generated Prisma Client" sem erros.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260725120000_reengage_only_ai_parked
git commit -m "feat(schema): reengage_only_ai_parked + require_ai_parked (aditivo)"
```

---

### Task 2: Util `isAiParked` (+ teste)

**Files:**
- Create: `src/common/utils/ai-parked.util.ts`
- Test: `src/common/utils/ai-parked.util.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { isAiParked } from './ai-parked.util';

describe('isAiParked', () => {
  const parked = { assignedToId: null, awaitingHumanReply: false, aiEnabled: null };

  it('true quando sem humano e IA não desligada', () => {
    expect(isAiParked(parked)).toBe(true);
    expect(isAiParked({ ...parked, aiEnabled: true })).toBe(true);
  });

  it('false quando tem vendedor atribuído', () => {
    expect(isAiParked({ ...parked, assignedToId: 'u1' })).toBe(false);
  });

  it('false quando aguardando humano', () => {
    expect(isAiParked({ ...parked, awaitingHumanReply: true })).toBe(false);
  });

  it('false quando a IA foi desligada na conversa (aiEnabled=false)', () => {
    expect(isAiParked({ ...parked, aiEnabled: false })).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/common/utils/ai-parked.util.spec.ts`
Expected: FAIL "Cannot find module './ai-parked.util'".

- [ ] **Step 3: Implementar o util**

```ts
/**
 * "Parado na IA" (fase Aline): a conversa ainda está sob a IA, sem humano.
 * Usado pelos motores de reengajamento (Inatividade + Cadência NO_REPLY) para
 * não reengajar leads que já foram para um atendente humano.
 *
 * aiEnabled é tri-state: null = segue org (conta como ativa), true = forçada ON,
 * false = desligada manualmente na conversa (única que exclui).
 */
export function isAiParked(c: {
  assignedToId: string | null;
  awaitingHumanReply: boolean;
  aiEnabled: boolean | null;
}): boolean {
  return !c.assignedToId && !c.awaitingHumanReply && c.aiEnabled !== false;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/common/utils/ai-parked.util.spec.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/common/utils/ai-parked.util.ts src/common/utils/ai-parked.util.spec.ts
git commit -m "feat(util): isAiParked (parado na fase da IA)"
```

---

### Task 3: Motor B — gate `aiEnabled` no enrollment + `requireAiParked` no passo

**Files:**
- Modify: `src/modules/cadences/cadence-runner.service.ts` (`maybeStartForNoReply` ~443; `scheduleStepAt` create ~525)
- Test: `src/modules/cadences/cadence-runner.service.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar dentro de `describe('CadenceRunner.maybeStartForNoReply', ...)`:

```ts
  it('NÃO inscreve quando a IA foi desligada na conversa (aiEnabled=false)', async () => {
    const { runner, cadences, prisma } = makeDeps();
    prisma.conversation.findUnique.mockResolvedValue({ ...conv, aiEnabled: false });
    cadences.findNoReply.mockResolvedValue(
      makeCadence({ id: 'cad-nr', trigger: 'NO_REPLY', enabled: true, watchedStageIds: [] }),
    );
    const startSpy = jest.spyOn(runner, 'start').mockResolvedValue({ id: 'e1' } as any);

    const result = await runner.maybeStartForNoReply('c1');

    expect(startSpy).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/cadences/cadence-runner.service.spec.ts -t "aiEnabled=false"`
Expected: FAIL (start é chamado; result não é null).

- [ ] **Step 3: Adicionar `aiEnabled` ao gate pré-humano**

Em `maybeStartForNoReply`, trocar:

```ts
    // Pré-humano: ninguém dono da conversa e não está na fila de espera humana.
    if (conversation.assignedToId || conversation.awaitingHumanReply) {
      return null;
    }
```

por:

```ts
    // Pré-humano e IA ativa (parado na fase da Aline). aiEnabled=false = IA
    // desligada manualmente na conversa → não reengaja.
    if (
      conversation.assignedToId ||
      conversation.awaitingHumanReply ||
      conversation.aiEnabled === false
    ) {
      return null;
    }
```

- [ ] **Step 4: Gravar `requireAiParked` no passo da cadência**

Em `scheduleStepAt`, no `this.schedRepo.create({ ... })`, adicionar após `attempt: 1,`:

```ts
      requireAiParked: true,
```

- [ ] **Step 5: Rodar os testes do runner**

Run: `npx jest src/modules/cadences/cadence-runner.service.spec.ts`
Expected: PASS (todos, incluindo o novo).

- [ ] **Step 6: Commit**

```bash
git add src/modules/cadences/cadence-runner.service.ts src/modules/cadences/cadence-runner.service.spec.ts
git commit -m "feat(cadence): NO_REPLY só inscreve com IA ativa + marca requireAiParked"
```

---

### Task 4: Motor A — settings service/DTO passam `reengageOnlyAiParked`

**Files:**
- Modify: `src/modules/scheduling/inactivity/inactivity-settings.service.ts`
- Modify: `src/modules/scheduling/inactivity/dto/update-inactivity-settings.dto.ts`
- Test: `src/modules/scheduling/inactivity/inactivity-settings.service.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao describe existente (segue o padrão do arquivo — mocka `repo.find`/`repo.upsert`):

```ts
  it('expõe reengageOnlyAiParked no get (default false; usa valor do row)', async () => {
    const repo = { find: jest.fn(async () => null), upsert: jest.fn() };
    const svc = new InactivitySettingsService(repo as any);
    expect((await svc.get('org1')).reengageOnlyAiParked).toBe(false);

    repo.find = jest.fn(async () => ({
      organizationId: 'org1', enabled: true, bandsDays: [3, 7], autoReengage: true,
      reengageFromBand: 1, maxAttempts: 2, retryEveryHours: 48,
      quietHoursStart: null, quietHoursEnd: null, reengageOnlyAiParked: true,
    })) as any;
    expect((await svc.get('org1')).reengageOnlyAiParked).toBe(true);
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/scheduling/inactivity/inactivity-settings.service.spec.ts -t "reengageOnlyAiParked"`
Expected: FAIL (undefined, não false/true).

- [ ] **Step 3: Adicionar ao default + resolver + DTO**

Em `inactivity-settings.service.ts`, em `DEFAULT_INACTIVITY_SETTINGS`, após `quietHoursEnd: null as number | null,`:

```ts
  reengageOnlyAiParked: false,
```

No `get`, dentro do bloco `...(row ? { ... } : {})`, após `quietHoursEnd: row.quietHoursEnd,`:

```ts
            reengageOnlyAiParked: row.reengageOnlyAiParked,
```

Em `dto/update-inactivity-settings.dto.ts`, adicionar antes do fechamento da classe:

```ts
  @ApiPropertyOptional() @IsOptional() @IsBoolean() reengageOnlyAiParked?: boolean;
```

(O `update` já faz `const data: any = { ...dto }` → o campo flui pro upsert sem mais mudanças.)

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/scheduling/inactivity/inactivity-settings.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/scheduling/inactivity/inactivity-settings.service.ts src/modules/scheduling/inactivity/dto/update-inactivity-settings.dto.ts src/modules/scheduling/inactivity/inactivity-settings.service.spec.ts
git commit -m "feat(inactivity): settings expõem reengageOnlyAiParked"
```

---

### Task 5: Motor A — watchdog pula não-parados + `scanCandidates` traz `aiEnabled`

**Files:**
- Modify: `src/modules/scheduling/inactivity/inactivity.repository.ts` (`scanCandidates` select)
- Modify: `src/modules/scheduling/inactivity/inactivity-watchdog.cron.ts` (loop, ~103)
- Test: `src/modules/scheduling/inactivity/inactivity-watchdog.cron.spec.ts` (criar se não existir)

- [ ] **Step 1: Adicionar `aiEnabled` ao select do `scanCandidates`**

Em `inactivity.repository.ts`, no `select` de `scanCandidates`, após `assignedToId: true,`:

```ts
        awaitingHumanReply: true,
        aiEnabled: true,
```

- [ ] **Step 2: Escrever o teste do watchdog**

Se `inactivity-watchdog.cron.spec.ts` não existe, criar com este conteúdo (mocka deps mínimas; foca no gate):

```ts
import { InactivityWatchdogCron } from './inactivity-watchdog.cron';

function makeCron(cfg: any, candidates: any[]) {
  const queue = { add: jest.fn(async () => ({})) };
  const repo = {
    scanCandidates: jest.fn(async () => candidates),
    setBandBulk: jest.fn(async () => ({})),
  };
  const settingsRepo = { listEnabledOrgIds: jest.fn(async () => [{ organizationId: 'org1' }]) };
  const settings = { get: jest.fn(async () => cfg) };
  const realtime = { emitToConversation: jest.fn() };
  const autoReengage = { maybeCreate: jest.fn(async () => undefined) };
  const cron = new InactivityWatchdogCron(
    queue as any, repo as any, settingsRepo as any, settings as any,
    realtime as any, autoReengage as any,
  );
  return { cron, autoReengage };
}

const baseCfg = {
  enabled: true, autoReengage: true, reengageFromBand: 0, bandsDays: [1, 3, 7],
  reengageOnlyAiParked: false,
};
// band computada >= reengageFromBand: conversa silenciada há muito.
const parked = {
  id: 'c1', assignedToId: null, awaitingHumanReply: false, aiEnabled: null,
  inactivityBand: 0, lastInboundAt: null,
  lastOutboundAt: new Date(Date.now() - 30 * 864e5),
  contactId: 'ct1', channelId: 'ch1', reengageDismissedAt: null, reengagedAt: null,
};
const withHuman = { ...parked, id: 'c2', assignedToId: 'u1' };

describe('InactivityWatchdogCron — recorte AI-parked', () => {
  it('com toggle OFF: chama maybeCreate mesmo para lead com humano (comportamento atual)', async () => {
    const { cron, autoReengage } = makeCron(baseCfg, [withHuman]);
    await cron.process({} as any);
    expect(autoReengage.maybeCreate).toHaveBeenCalled();
  });

  it('com toggle ON: pula lead com humano e mantém lead parado na IA', async () => {
    const { cron, autoReengage } = makeCron(
      { ...baseCfg, reengageOnlyAiParked: true }, [parked, withHuman],
    );
    await cron.process({} as any);
    const ids = autoReengage.maybeCreate.mock.calls.map((c: any[]) => c[1].id);
    expect(ids).toContain('c1');
    expect(ids).not.toContain('c2');
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx jest src/modules/scheduling/inactivity/inactivity-watchdog.cron.spec.ts`
Expected: FAIL no 2º teste (c2 ainda recebe maybeCreate — gate ausente).

- [ ] **Step 4: Adicionar o gate no loop do watchdog**

Em `inactivity-watchdog.cron.ts`, importar no topo:

```ts
import { isAiParked } from '../../../common/utils/ai-parked.util';
```

No bloco `if (cfg.autoReengage && isEligibleForReengage(band, cfg.reengageFromBand))`, trocar a condição para também respeitar o recorte:

```ts
        if (
          cfg.autoReengage &&
          isEligibleForReengage(band, cfg.reengageFromBand) &&
          (!cfg.reengageOnlyAiParked || isAiParked(c))
        ) {
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx jest src/modules/scheduling/inactivity/inactivity-watchdog.cron.spec.ts`
Expected: PASS (2 testes).

- [ ] **Step 6: Commit**

```bash
git add src/modules/scheduling/inactivity/inactivity.repository.ts src/modules/scheduling/inactivity/inactivity-watchdog.cron.ts src/modules/scheduling/inactivity/inactivity-watchdog.cron.spec.ts
git commit -m "feat(inactivity): watchdog pula não-parados quando reengageOnlyAiParked"
```

---

### Task 6: Motor A — `maybeCreate` grava `requireAiParked`

**Files:**
- Modify: `src/modules/scheduling/inactivity/auto-reengage.service.ts` (create ~67)
- Test: `src/modules/scheduling/inactivity/auto-reengage.service.spec.ts`

- [ ] **Step 1: Ajustar o teste existente + adicionar caso**

No `auto-reengage.service.spec.ts`, no objeto `cfg`, adicionar `reengageOnlyAiParked: false,`. Depois adicionar:

```ts
  it('grava requireAiParked = valor do cfg', async () => {
    const { service, schedRepo } = makeDeps();
    await service.maybeCreate('org1', conv, 2, { ...cfg, reengageOnlyAiParked: true });
    expect(schedRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ requireAiParked: true }),
    );
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/scheduling/inactivity/auto-reengage.service.spec.ts -t "requireAiParked"`
Expected: FAIL (campo ausente no create).

- [ ] **Step 3: Gravar o flag no create**

Em `auto-reengage.service.ts`, no `this.schedRepo.create({ ... })`, após `retryEveryHours: cfg.retryEveryHours,`:

```ts
      requireAiParked: cfg.reengageOnlyAiParked,
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/scheduling/inactivity/auto-reengage.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/scheduling/inactivity/auto-reengage.service.ts src/modules/scheduling/inactivity/auto-reengage.service.spec.ts
git commit -m "feat(inactivity): AUTO_REENGAGE grava requireAiParked"
```

---

### Task 7: Corte no envio — guarda `requireAiParked` no processor

**Files:**
- Modify: `src/modules/scheduling/scheduled-dispatch.processor.ts` (select ~31; guarda após ~65; retry ~104-119)
- Test: `src/modules/scheduling/scheduled-dispatch.processor.spec.ts`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao describe:

```ts
  it('cancela not_ai_parked quando requireAiParked e a conversa foi para humano', async () => {
    const row = { ...base, origin: 'AUTO_REENGAGE', requireAiParked: true };
    const { processor, repo, messages } = makeDeps(row);
    (processor as any).prisma = undefined; // guarda: usar o findUnique abaixo
    // Sobrescreve o findUnique para retornar conversa com humano.
    const prisma = {
      conversation: {
        findUnique: jest.fn(async () => ({
          id: 'c1', status: 'OPEN', isArchived: false, lastInboundAt: null,
          assignedToId: 'u1', awaitingHumanReply: false, aiEnabled: null,
        })),
      },
    };
    (processor as any).prisma = prisma;
    await processor.process({ data: { scheduledMessageId: 's1' } } as any);
    expect(messages.send).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('s1', expect.objectContaining({
      status: 'CANCELED', cancelReason: 'not_ai_parked',
    }));
  });

  it('envia normalmente quando requireAiParked e a conversa ainda está parada na IA', async () => {
    const row = { ...base, origin: 'CADENCE', requireAiParked: true, cadenceEnrollmentId: 'e1', cadenceStepOrder: 1 };
    const { processor, messages } = makeDeps(row);
    (processor as any).prisma = {
      conversation: {
        findUnique: jest.fn(async () => ({
          id: 'c1', status: 'OPEN', isArchived: false, lastInboundAt: null,
          assignedToId: null, awaitingHumanReply: false, aiEnabled: null,
        })),
      },
    };
    await processor.process({ data: { scheduledMessageId: 's1' } } as any);
    expect(messages.send).toHaveBeenCalled();
  });
```

> Nota p/ o worker: se preferir, estenda o `makeDeps` para aceitar overrides do `findUnique` em vez de reatribuir `(processor as any).prisma` — o essencial é o findUnique retornar `assignedToId/awaitingHumanReply/aiEnabled`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/scheduling/scheduled-dispatch.processor.spec.ts -t "not_ai_parked"`
Expected: FAIL (envia; não cancela).

- [ ] **Step 3: Ampliar o select da conversa**

Em `scheduled-dispatch.processor.ts`, no `findUnique`:

```ts
      select: {
        id: true, status: true, isArchived: true, lastInboundAt: true,
        assignedToId: true, awaitingHumanReply: true, aiEnabled: true,
      },
```

- [ ] **Step 4: Adicionar a guarda (após o backstop client_replied, antes do claim)**

Importar no topo:

```ts
import { isAiParked } from '../../common/utils/ai-parked.util';
```

Inserir logo após o bloco `if (replyCancelable && ...) { ... return; }` (antes de `const claimed = ...`):

```ts
    // Corte "parado na IA": se o agendamento exige lead sob a IA e um humano
    // assumiu (ou a IA foi desligada) depois de criado, não envia. No
    // AUTO_REENGAGE isso também impede o próximo toque (return antes do retry).
    if (
      row.requireAiParked &&
      !isAiParked({
        assignedToId: conversation.assignedToId,
        awaitingHumanReply: conversation.awaitingHumanReply,
        aiEnabled: conversation.aiEnabled,
      })
    ) {
      await this.repo.update(row.id, {
        status: 'CANCELED',
        canceledAt: new Date(),
        cancelReason: 'not_ai_parked',
      });
      return;
    }
```

- [ ] **Step 5: Propagar `requireAiParked` no auto-retry (AUTO_REENGAGE)**

No bloco de retry (`this.repo.create({ ... })`), após `retryEveryHours: row.retryEveryHours,`:

```ts
          requireAiParked: row.requireAiParked,
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx jest src/modules/scheduling/scheduled-dispatch.processor.spec.ts`
Expected: PASS (todos, incluindo os 2 novos).

- [ ] **Step 7: Commit**

```bash
git add src/modules/scheduling/scheduled-dispatch.processor.ts src/modules/scheduling/scheduled-dispatch.processor.spec.ts
git commit -m "feat(dispatch): corta reengajamento no envio quando lead saiu da IA"
```

---

### Task 8: Web — toggle no Motor A (Inatividade)

**Files (worktree web a criar):**
- Modify: `src/features/scheduling/types.ts` (interface `InactivitySettings`)
- Modify: `src/features/scheduling/components/inactivity-settings-form.tsx` (novo `<Row>` + payload do `save`)

- [ ] **Step 1: Criar o worktree web**

```bash
cd "/Users/kleber/Desktop/agent-browser-0.2.0 2/Teste.md/Chat OFP/chat-bullq-web"
git fetch fork feat/conversation-tabs
git worktree add -b feat/reengage-only-ai-parked "../.wt-reengage-ai-parked-web" fork/feat/conversation-tabs
```

- [ ] **Step 2: Adicionar o campo na interface**

Em `src/features/scheduling/types.ts`, na interface `InactivitySettings`, após `quietHoursEnd: number | null;`:

```ts
  reengageOnlyAiParked: boolean;
```

- [ ] **Step 3: Adicionar o `<Row>` com o toggle**

Em `inactivity-settings-form.tsx`, logo após o `<Row>` de "Reengajar automaticamente":

```tsx
        <Row
          title="Reengajar apenas leads parados na IA"
          description="Só reengaja quem ainda está com a IA (Aline), sem atendente humano. Se um humano assumir, o reengajamento pendente é cancelado."
        >
          <Toggle
            checked={form.reengageOnlyAiParked}
            disabled={!canEdit || !form.autoReengage}
            onChange={(v) => set('reengageOnlyAiParked', v)}
          />
        </Row>
```

- [ ] **Step 4: Incluir o campo no payload do `save`**

Em `save()`, no objeto passado a `update.mutate({ ... })`, após `quietHoursEnd: form.quietHoursEnd,`:

```ts
        reengageOnlyAiParked: form.reengageOnlyAiParked,
```

- [ ] **Step 5: Build/typecheck**

Run (no worktree web): `npm run build` (ou `npx tsc --noEmit` se mais rápido)
Expected: sem erros de tipo relacionados a `reengageOnlyAiParked`.

- [ ] **Step 6: Commit**

```bash
git add src/features/scheduling/types.ts src/features/scheduling/components/inactivity-settings-form.tsx
git commit -m "feat(inactivity): toggle 'Reengajar apenas leads parados na IA'"
```

---

### Task 9: Verificação final + PRs

- [ ] **Step 1: Suite completa da API**

Run (worktree API): `npm test`
Expected: verde (todos os specs, incl. os novos das Tasks 2–7).

- [ ] **Step 2: Build da API**

Run: `npm run build`
Expected: sem erros TS.

- [ ] **Step 3: Push das branches**

```bash
# API
git -C ".wt-reengage-ai-parked" push -u fork feat/reengage-only-ai-parked
# Web
git -C ".wt-reengage-ai-parked-web" push -u fork feat/reengage-only-ai-parked
```

- [ ] **Step 4: Abrir os PRs (base `feat/conversation-tabs`)**

```bash
gh pr create --repo klebermdc/chat-bullq-api --base feat/conversation-tabs --head feat/reengage-only-ai-parked \
  --title "feat: reengajamento apenas para leads parados na IA" \
  --body "Motores AUTO_REENGAGE + CADENCE só reengajam leads parados na fase da IA (sem humano E IA ativa). Toggle no menu (default OFF) no Motor A; corte no envio via requireAiParked. Ver docs/superpowers/specs/2026-07-24-reengajamento-parado-na-ia-design.md"
gh pr create --repo klebermdc/chat-bullq-web --base feat/conversation-tabs --head feat/reengage-only-ai-parked \
  --title "feat(inactivity): toggle 'Reengajar apenas leads parados na IA'" \
  --body "Toggle no Settings → Inatividade. Pareia com a API."
```

- [ ] **Step 5: Deploy** — seguir `DEPLOY-PROTOCOL.md` / `deploy-safe.sh` (mergear na live, `git reset` no VPS antes do `docker compose up -d --build`, confirmar sentinela `require_ai_parked` no container + migração aplicada no boot). Toggle vem OFF → nada muda até ligar em Settings → Inatividade.

## Notas de verificação (spec self-review)

- **Cobertura:** util (T2), Motor B enrollment+flag (T3), settings (T4), watchdog gate (T5), maybeCreate flag (T6), corte no envio + retry (T7), web toggle (T8). ✔
- **Consistência de nomes:** `reengageOnlyAiParked` (settings/DTO/cfg/web), `requireAiParked` (ScheduledMessage/create/retry/guarda), `isAiParked` (util). ✔
- **Default OFF:** T1 default false; T5 gate `!cfg.reengageOnlyAiParked || isAiParked` → OFF mantém atual; T7 guarda só dispara com `requireAiParked` true. ✔
