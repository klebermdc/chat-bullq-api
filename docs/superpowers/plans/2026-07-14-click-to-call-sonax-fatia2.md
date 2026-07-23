# Click to Call (Sonax) — Fatia 2: Webhook de desligamento + gravação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Receber o webhook de desligamento da Sonax, atualizar o `Call` (status/duração/gravação) e a `Message` SYSTEM espelhada, e refletir em tempo real na timeline ("✅ Atendida · 3m12s · ▶️ gravação").

**Architecture:** Endpoint público (`@Public()`) `GET|POST /webhooks/sonax/:secret` — autenticado pelo `webhookSecret` por org (mesmo padrão do `KirvanoWebhookController`). Correlaciona a ligação por `var_1 = call.id`, valida escopo de tenant, mapeia o status Sonax → `CallStatus`, é **idempotente** e responde `200` rápido (a Sonax bloqueia após 3× 404).

**Tech Stack:** NestJS + Prisma, Jest. Reusa `RealtimeGateway.emitToConversation`. Depende da Fatia 1 (models `Call`/`SonaxSettings`, `Message` SYSTEM `kind=call`).

Spec: `docs/superpowers/specs/2026-07-14-click-to-call-sonax-design.md`.

---

## File Structure

- `src/modules/calls/sonax-status.util.ts` (+ spec) — mapeia status Sonax → `CallStatus` + `answered`.
- `src/modules/calls/sonax-webhook.service.ts` (+ spec) — aplica o webhook ao `Call` + `Message` (idempotente, cross-tenant safe).
- `src/modules/calls/sonax-webhook.controller.ts` — rota pública `webhooks/sonax/:secret`.
- `src/modules/calls/calls.module.ts` — MODIFY: registra service + controller.

---

## Task 1: Mapa de status Sonax → CallStatus

**Files:**
- Create: `src/modules/calls/sonax-status.util.ts`
- Test: `src/modules/calls/sonax-status.util.spec.ts`

- [ ] **Step 1: Teste que falha**

```ts
import { mapSonaxStatus } from './sonax-status.util';

describe('mapSonaxStatus', () => {
  it('mapeia os status conhecidos', () => {
    expect(mapSonaxStatus('discando').status).toBe('DIALING');
    expect(mapSonaxStatus('andamento').status).toBe('RINGING');
    expect(mapSonaxStatus('falando').status).toBe('TALKING');
    expect(mapSonaxStatus('ramal atendeu').status).toBe('ANSWERED');
    expect(mapSonaxStatus('ocupado').status).toBe('BUSY');
    expect(mapSonaxStatus('indisponível').status).toBe('NO_ANSWER');
    expect(mapSonaxStatus('ramal falhou').status).toBe('NO_ANSWER');
    expect(mapSonaxStatus('desligada').status).toBe('FINISHED');
  });
  it('é case-insensitive e tolera acento ausente', () => {
    expect(mapSonaxStatus('INDISPONIVEL').status).toBe('NO_ANSWER');
  });
  it('deriva answered de statusAtendimento=S', () => {
    expect(mapSonaxStatus('desligada', 'S').answered).toBe(true);
    expect(mapSonaxStatus('desligada', 'N').answered).toBe(false);
  });
  it('status desconhecido cai em FINISHED sem quebrar', () => {
    expect(mapSonaxStatus('qualquer-coisa').status).toBe('FINISHED');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/calls/sonax-status.util.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
import { CallStatus } from '@prisma/client';

const MAP: Record<string, CallStatus> = {
  discando: 'DIALING',
  andamento: 'RINGING',
  falando: 'TALKING',
  'ramal atendeu': 'ANSWERED',
  'ramal falhou': 'NO_ANSWER',
  ocupado: 'BUSY',
  indisponivel: 'NO_ANSWER',
  desligada: 'FINISHED',
};

function normalize(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .trim();
}

export function mapSonaxStatus(
  statusChamada: string,
  statusAtendimento?: string,
): { status: CallStatus; answered: boolean } {
  const key = normalize(statusChamada);
  const status = MAP[key] ?? 'FINISHED';
  const answered = normalize(statusAtendimento ?? '') === 's' || status === 'ANSWERED';
  return { status, answered };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/calls/sonax-status.util.spec.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/calls/sonax-status.util.ts src/modules/calls/sonax-status.util.spec.ts
git commit -m "feat(calls): mapa de status Sonax -> CallStatus"
```

---

## Task 2: `SonaxWebhookService` (idempotente + cross-tenant safe)

**Files:**
- Create: `src/modules/calls/sonax-webhook.service.ts`
- Test: `src/modules/calls/sonax-webhook.service.spec.ts`

- [ ] **Step 1: Teste que falha**

```ts
import { SonaxWebhookService } from './sonax-webhook.service';

function makeDeps(over: any = {}) {
  const state = {
    settings: over.settings ?? { organizationId: 'org1', webhookSecret: 'secretA' },
    call: over.call ?? { id: 'call1', organizationId: 'org1', conversationId: 'conv1', messageId: 'msg1', status: 'DIALING' },
  };
  const updated: any = {};
  const prisma = {
    sonaxSettings: { findFirst: jest.fn(async ({ where }) => (where.webhookSecret === state.settings.webhookSecret ? state.settings : null)) },
    call: {
      findUnique: jest.fn(async () => state.call),
      update: jest.fn(async ({ data }) => { updated.call = data; return { ...state.call, ...data }; }),
    },
    message: { update: jest.fn(async ({ data }) => { updated.message = data; return data; }) },
  } as any;
  const realtime = { emitToConversation: jest.fn() } as any;
  return { prisma, realtime, updated, svc: new SonaxWebhookService(prisma, realtime) };
}

describe('SonaxWebhookService.apply', () => {
  const q = { var_1: 'call1', status: 'desligada', status_atend: 'S', duracao: '192', url_gravacao: 'https://rec/x' };

  it('atualiza Call e Message quando secret e org batem', async () => {
    const d = makeDeps();
    await d.svc.apply('secretA', q);
    expect(d.updated.call.status).toBe('FINISHED');
    expect(d.updated.call.durationSec).toBe(192);
    expect(d.updated.call.recordingUrl).toBe('https://rec/x');
    expect(d.updated.message.content.status).toBe('FINISHED');
    expect(d.realtime.emitToConversation).toHaveBeenCalled();
  });

  it('secret inválido => NotFound (nunca deixa passar)', async () => {
    const d = makeDeps();
    await expect(d.svc.apply('secretERRADO', q)).rejects.toBeTruthy();
  });

  it('rejeita cross-tenant: Call de outra org não é tocado', async () => {
    const d = makeDeps({ call: { id: 'call1', organizationId: 'orgOUTRA', conversationId: 'c', messageId: 'm', status: 'DIALING' } });
    await expect(d.svc.apply('secretA', q)).rejects.toBeTruthy();
    expect(d.prisma.call.update).not.toHaveBeenCalled();
  });

  it('idempotente: Call já FINISHED não reprocessa nem duplica', async () => {
    const d = makeDeps({ call: { id: 'call1', organizationId: 'org1', conversationId: 'conv1', messageId: 'msg1', status: 'FINISHED' } });
    const res = await d.svc.apply('secretA', q);
    expect(res.skipped).toBe(true);
    expect(d.prisma.call.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/calls/sonax-webhook.service.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { mapSonaxStatus } from './sonax-status.util';

// estados terminais: se o Call já está num deles, o webhook é ignorado (idempotência).
const TERMINAL = new Set(['FINISHED', 'NO_ANSWER', 'BUSY', 'FAILED']);

export interface SonaxWebhookQuery {
  var_1?: string;
  status?: string;
  status_atend?: string;
  duracao?: string;
  url_gravacao?: string;
  [k: string]: any;
}

@Injectable()
export class SonaxWebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async apply(secret: string, q: SonaxWebhookQuery): Promise<{ ok: true; skipped?: boolean }> {
    // 1. secret -> org (autenticação)
    const settings = await this.prisma.sonaxSettings.findFirst({ where: { webhookSecret: secret } });
    if (!settings) throw new NotFoundException('secret inválido');

    const callId = q.var_1;
    if (!callId) return { ok: true, skipped: true }; // nada a correlacionar; responde 200

    const call = await this.prisma.call.findUnique({ where: { id: callId } });
    // 2. cross-tenant: o Call tem que ser da MESMA org do secret
    if (!call || call.organizationId !== settings.organizationId) {
      throw new NotFoundException('call não encontrado para esta organização');
    }

    // 3. idempotência
    if (TERMINAL.has(call.status)) return { ok: true, skipped: true };

    const { status, answered } = mapSonaxStatus(q.status ?? '', q.status_atend);
    const durationSec = q.duracao ? parseInt(String(q.duracao), 10) : undefined;
    const recordingUrl = q.url_gravacao || undefined;
    const isTerminal = TERMINAL.has(status);

    await this.prisma.call.update({
      where: { id: call.id },
      data: {
        status,
        answered,
        ...(durationSec !== undefined && !Number.isNaN(durationSec) ? { durationSec } : {}),
        ...(recordingUrl ? { recordingUrl } : {}),
        ...(isTerminal ? { endedAt: new Date() } : {}),
        raw: q as any,
      },
    });

    // 4. reflete na Message SYSTEM espelhada + realtime
    const content = {
      kind: 'call',
      callId: call.id,
      status,
      answered,
      ...(durationSec !== undefined && !Number.isNaN(durationSec) ? { durationSec } : {}),
      ...(recordingUrl ? { recordingUrl } : {}),
    };
    if (call.messageId) {
      await this.prisma.message.update({ where: { id: call.messageId }, data: { content } });
      this.realtime.emitToConversation(call.conversationId, 'message:update', { messageId: call.messageId, content });
    }

    return { ok: true };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/calls/sonax-webhook.service.spec.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/calls/sonax-webhook.service.ts src/modules/calls/sonax-webhook.service.spec.ts
git commit -m "feat(calls): SonaxWebhookService (idempotente, cross-tenant safe)"
```

---

## Task 3: Controller público do webhook

**Files:**
- Create: `src/modules/calls/sonax-webhook.controller.ts`
- Modify: `src/modules/calls/calls.module.ts`

- [ ] **Step 1: Controller (molde: `KirvanoWebhookController`)**

A Sonax faz um **GET** substituindo placeholders na URL; aceitamos GET e POST por robustez. `@Public()` + `@HttpCode(200)`. Nunca deixar estourar 404 pra payload válido — o service já responde/lança de forma controlada; erros de secret viram 404 (só nesses casos, que são inválidos mesmo).

```ts
import { Controller, Get, Post, Param, Query, HttpCode } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { SonaxWebhookService, SonaxWebhookQuery } from './sonax-webhook.service';

@ApiTags('Webhooks')
@Controller('webhooks/sonax')
export class SonaxWebhookController {
  constructor(private readonly service: SonaxWebhookService) {}

  @Get(':secret')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Recebe o webhook de desligamento da Sonax (GET com placeholders)' })
  handleGet(@Param('secret') secret: string, @Query() q: SonaxWebhookQuery) {
    return this.service.apply(secret, q);
  }

  @Post(':secret')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Recebe o webhook de desligamento da Sonax (POST)' })
  handlePost(@Param('secret') secret: string, @Query() q: SonaxWebhookQuery) {
    return this.service.apply(secret, q);
  }
}
```

> Confirme o import do `Public` (`src/common/decorators`) igual ao usado no `KirvanoWebhookController`.

- [ ] **Step 2: Registrar no CallsModule**

Em `calls.module.ts`: adicione `SonaxWebhookController` em `controllers` e `SonaxWebhookService` em `providers`.

- [ ] **Step 3: Build + testes do módulo**

Run: `npx tsc --noEmit && npx jest src/modules/calls`
Expected: sem erro de tipo; todos os specs do módulo `calls` verdes.

- [ ] **Step 4: Smoke manual do endpoint (sem Sonax)**

Suba a API. Crie um Call via a Fatia 1 (clicando 📞) — pegue o `call.id`. Simule a Sonax:

```bash
curl -i "http://localhost:3001/api/v1/webhooks/sonax/<SECRET_DA_ORG>?var_1=<CALL_ID>&status=desligada&status_atend=S&duracao=192&url_gravacao=https://rec/x"
```

Expected: `HTTP 200`; o `Call` vira `FINISHED` com `durationSec=192`, `recordingUrl` setada; a timeline atualiza pra "✅ Atendida · 3m12s · ▶️ gravação" em tempo real. Repetir o mesmo curl não muda nada (idempotente).

> Ajuste host/porta/prefixo (`/api/v1`) ao ambiente. Pegue `<SECRET_DA_ORG>` da tela de config Sonax (a `webhookUrl` já vem com ele).

- [ ] **Step 5: Commit**

```bash
git add src/modules/calls/sonax-webhook.controller.ts src/modules/calls/calls.module.ts
git commit -m "feat(calls): endpoint público do webhook Sonax (GET/POST :secret)"
```

---

## Self-Review (executar antes de encerrar a Fatia 2)

1. **Cobertura do spec (Fatia 2):** mapa de status ✅ (Task 1), webhook público por secret ✅ (Task 3), correlação por `var_1` ✅ (Task 2), idempotência ✅ (Task 2), anti cross-tenant ✅ (Task 2), atualização da Message + realtime ✅ (Task 2), gravação (`url_gravacao`) ✅ (Task 2).
2. **Placeholders:** nenhum `TBD`. Confirmar só o import do `Public` e o prefixo de rota (`/api/v1`) no smoke.
3. **Consistência de tipos:** `content.kind='call'`, `content.status`, `content.callId`, `content.durationSec`, `content.recordingUrl` batem com o `CallCard` e o `CallsService` da Fatia 1. Eventos: `message:update` (mesmo nome usado na Fatia 1 no caminho de falha). `CallStatus` importado de `@prisma/client`.

## Deploy (Fatia 2)

- Deploy da API no VPS (migração já foi na Fatia 1).
- Na Sonax: colar a `webhookUrl` (da tela de config) no campo **URL de desligamento** da campanha/discador. Confirmar com o suporte Sonax que a `<URL_GRAVACAO>` é enviada nesse evento.
- E2E real: clicar 📞 → atender no ramal → falar → desligar → em segundos o card mostra status final + duração + link da gravação. Testar não-atendida (deixar tocar) e ocupado.
- Verificar nos logs que reentregas do mesmo webhook não duplicam (idempotência) e que nenhum `404` é retornado pra payload válido (Sonax bloqueia após 3× 404 seguidos).
