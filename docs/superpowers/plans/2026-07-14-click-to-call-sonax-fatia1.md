# Click to Call (Sonax) — Fatia 1: Config + Ramal + Disparo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atendente clica 📞 no header da conversa e a Sonax inicia uma ligação ramal-first com o cliente; a config Sonax (por org) e o ramal (por atendente) são gerenciáveis pelo admin. A ligação aparece na timeline como "📞 Ligação iniciada" (o resultado/gravação vem na Fatia 2).

**Architecture:** Novo módulo NestJS `calls`. O disparo é feito no backend (nunca no navegador) via `GET` ao `click2call` da Sonax, passando `var_1=call.id`. Um model `Call` (fonte da verdade) é criado no estado `DIALING` junto com uma `Message` SYSTEM espelhada na timeline. Config Sonax por org com token criptografado (reusa `CryptoService`); ramal por atendente em `UserOrganization`.

**Tech Stack:** NestJS + Prisma 6 + Postgres, Jest. Frontend Next.js + React Query. Criptografia AES-256-GCM (`CryptoService` existente). Realtime via `RealtimeGateway.emitToConversation`.

Spec: `docs/superpowers/specs/2026-07-14-click-to-call-sonax-design.md`.

---

## File Structure

**Backend (`chat-bullq-api`):**
- `prisma/schema.prisma` — MODIFY: `sonaxRamal` em `UserOrganization`; models `SonaxSettings`, `Call`; enum `CallStatus`; relações em `Organization`, `Conversation`, `User`.
- `src/modules/calls/phone.util.ts` (+ spec) — `normalizeBrazilNumber`.
- `src/modules/calls/sonax-client.ts` (+ spec) — dispara o GET pro click2call.
- `src/modules/calls/sonax-settings.service.ts` (+ spec) — get/upsert config + gera `webhookSecret`.
- `src/modules/calls/calls.service.ts` (+ spec) — `initiateCall`.
- `src/modules/calls/calls.controller.ts` — `POST /conversations/:id/call`.
- `src/modules/calls/sonax-settings.controller.ts` — `GET/PUT /organizations/settings/sonax`.
- `src/modules/calls/dto/upsert-sonax-settings.dto.ts`.
- `src/modules/calls/calls.module.ts` — wiring.
- `src/app.module.ts` — MODIFY: registra `CallsModule`.
- `src/modules/organizations/organizations.service.ts` / `.controller.ts` — MODIFY: `updateMemberRamal`.
- `src/modules/organizations/dto/update-member-ramal.dto.ts` (create).

**Frontend (`chat-bullq-web`):**
- `src/features/inbox/components/conversation-header.tsx` — MODIFY: botão 📞.
- `src/features/inbox/components/call-button.tsx` (create).
- `src/features/inbox/components/call-card.tsx` (create) — render da Message SYSTEM `kind=call`.
- `src/features/inbox/components/message-item.tsx` (ou equivalente) — MODIFY: dispatch pro `CallCard`.
- `src/features/settings/sonax/sonax-settings-page.tsx` (create) + entrada no menu de Configurações.
- `src/features/settings/members/*` — MODIFY: campo "Ramal Sonax".
- `src/lib/api/calls.ts` (create) — chamadas à API.

---

## Task 1: Schema — ramal, SonaxSettings, Call

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Adicionar `sonaxRamal` em `UserOrganization`**

Em `model UserOrganization`, logo após `preferences`:

```prisma
  sonaxRamal     String?     @map("sonax_ramal") // ramal Sonax do atendente; null = não pode ligar
```

- [ ] **Step 2: Adicionar enum e models ao final do schema**

```prisma
enum CallStatus {
  DIALING
  RINGING
  TALKING
  ANSWERED
  NO_ANSWER
  BUSY
  FAILED
  FINISHED
}

model SonaxSettings {
  id                String   @id @default(cuid())
  organizationId    String   @unique @map("organization_id")
  enabled           Boolean  @default(false)
  idCliente         String   @map("id_cliente")
  tokenEnc          String   @map("token_enc")
  webhookSecret     String   @map("webhook_secret")
  click2callBaseUrl String   @default("https://click2call.sonax.net.br/sonax-click2call.php") @map("click2call_base_url")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@map("sonax_settings")
}

model Call {
  id             String     @id @default(cuid())
  organizationId String     @map("organization_id")
  conversationId String     @map("conversation_id")
  agentId        String?    @map("agent_id")
  ramal          String
  numero         String
  status         CallStatus @default(DIALING)
  answered       Boolean    @default(false)
  durationSec    Int?       @map("duration_sec")
  recordingUrl   String?    @map("recording_url")
  messageId      String?    @map("message_id")
  startedAt      DateTime   @default(now()) @map("started_at")
  endedAt        DateTime?  @map("ended_at")
  raw            Json       @default("{}")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  conversation Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  agent        User?        @relation("CallAgent", fields: [agentId], references: [id], onDelete: SetNull)

  @@index([organizationId, startedAt])
  @@index([conversationId])
  @@map("calls")
}
```

- [ ] **Step 3: Adicionar relações inversas**

Em `model Organization` (junto das outras relações): `sonaxSettings SonaxSettings?` e `calls Call[]`.
Em `model Conversation`: `calls Call[]`.
Em `model User`: `initiatedCalls Call[] @relation("CallAgent")`.

- [ ] **Step 4: Gerar migração**

Run: `npx prisma migrate dev --name click_to_call_sonax`
Expected: cria migração, `prisma generate` roda, sem erro. Confirma que `calls`, `sonax_settings`, coluna `user_organizations.sonax_ramal` e o enum `CallStatus` aparecem no SQL gerado.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(calls): schema Sonax click-to-call (SonaxSettings, Call, ramal)"
```

---

## Task 2: `normalizeBrazilNumber`

**Files:**
- Create: `src/modules/calls/phone.util.ts`
- Test: `src/modules/calls/phone.util.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { normalizeBrazilNumber } from './phone.util';

describe('normalizeBrazilNumber', () => {
  it('remove máscara e mantém dígitos', () => {
    expect(normalizeBrazilNumber('(11) 99999-8888')).toBe('5511999998888');
  });
  it('adiciona DDI 55 quando ausente (11 dígitos)', () => {
    expect(normalizeBrazilNumber('11999998888')).toBe('5511999998888');
  });
  it('preserva DDI 55 quando já presente (13 dígitos)', () => {
    expect(normalizeBrazilNumber('5511999998888')).toBe('5511999998888');
  });
  it('lida com whatsapp jid (sufixo)', () => {
    expect(normalizeBrazilNumber('5511999998888@c.us')).toBe('5511999998888');
  });
  it('lança em número curto demais', () => {
    expect(() => normalizeBrazilNumber('123')).toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/calls/phone.util.spec.ts`
Expected: FAIL — `Cannot find module './phone.util'`.

- [ ] **Step 3: Implementar**

```ts
/**
 * Normaliza um telefone brasileiro para o formato E.164 sem "+": DDI 55 + DDD + número.
 * Aceita máscara, JID do WhatsApp e números com/sem DDI. Lança se ficar curto demais.
 */
export function normalizeBrazilNumber(input: string): string {
  const digits = (input || '').replace(/\D/g, '');
  if (digits.length < 10) {
    throw new Error(`Número inválido para discagem: "${input}"`);
  }
  // 10 (fixo) ou 11 (celular) dígitos = sem DDI -> prefixa 55.
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  // 12/13 dígitos começando com 55 = já tem DDI.
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits;
  }
  // fallback: devolve os dígitos como estão (números internacionais).
  return digits;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/calls/phone.util.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/calls/phone.util.ts src/modules/calls/phone.util.spec.ts
git commit -m "feat(calls): normalizeBrazilNumber"
```

---

## Task 3: `SonaxClient` (dispara o GET pro click2call)

**Files:**
- Create: `src/modules/calls/sonax-client.ts`
- Test: `src/modules/calls/sonax-client.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { SonaxClient } from './sonax-client';

describe('SonaxClient.click2call', () => {
  const OK = { ok: true, status: 200, text: async () => '1' } as any;

  it('monta a URL com numero, ramal, token e var_1', async () => {
    const fetchMock = jest.fn().mockResolvedValue(OK);
    const client = new SonaxClient(fetchMock);
    await client.click2call({
      baseUrl: 'https://click2call.sonax.net.br/sonax-click2call.php',
      numero: '5511999998888',
      ramal: '101',
      token: 'TOK123',
      var1: 'call_abc',
    });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('numero=5511999998888');
    expect(url).toContain('ramal=101');
    expect(url).toContain('token=TOK123');
    expect(url).toContain('var_1=call_abc');
  });

  it('lança quando a Sonax responde não-2xx', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'not found' });
    const client = new SonaxClient(fetchMock);
    await expect(
      client.click2call({ baseUrl: 'https://x', numero: '1', ramal: '1', token: 't', var1: 'c' }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/calls/sonax-client.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
import { Injectable } from '@nestjs/common';

export interface Click2CallParams {
  baseUrl: string;
  numero: string;
  ramal: string;
  token: string;
  var1: string;
}

type FetchFn = typeof fetch;

/**
 * Cliente HTTP fino para o discador Sonax. `fetch` é injetável para teste.
 * Timeout curto (8s): o disparo é "fire-and-forget" — a Sonax só confirma
 * que aceitou o comando; o resultado da ligação chega depois via webhook.
 */
@Injectable()
export class SonaxClient {
  constructor(private readonly fetchFn: FetchFn = fetch) {}

  async click2call(p: Click2CallParams): Promise<void> {
    const qs = new URLSearchParams({
      numero: p.numero,
      ramal: p.ramal,
      token: p.token,
      var_1: p.var1,
    });
    const url = `${p.baseUrl}?${qs.toString()}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await this.fetchFn(url, { method: 'GET', signal: ctrl.signal });
      if (!res.ok) {
        throw new Error(`Sonax respondeu ${res.status}`);
      }
    } finally {
      clearTimeout(t);
    }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/calls/sonax-client.spec.ts`
Expected: PASS (2 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/calls/sonax-client.ts src/modules/calls/sonax-client.spec.ts
git commit -m "feat(calls): SonaxClient click2call"
```

---

## Task 4: `SonaxSettingsService`

**Files:**
- Create: `src/modules/calls/sonax-settings.service.ts`
- Test: `src/modules/calls/sonax-settings.service.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { SonaxSettingsService } from './sonax-settings.service';

describe('SonaxSettingsService', () => {
  const crypto = { encrypt: (s: string) => `enc(${s})`, decrypt: (s: string) => s.replace(/^enc\(|\)$/g, '') } as any;
  const rows: any[] = [];
  const prisma = {
    sonaxSettings: {
      findUnique: jest.fn(async ({ where }) => rows.find((r) => r.organizationId === where.organizationId) || null),
      upsert: jest.fn(async ({ where, create, update }) => {
        const i = rows.findIndex((r) => r.organizationId === where.organizationId);
        if (i >= 0) { rows[i] = { ...rows[i], ...update }; return rows[i]; }
        const row = { id: 'ss1', ...create }; rows.push(row); return row;
      }),
    },
  } as any;

  beforeEach(() => { rows.length = 0; });

  it('upsert criptografa o token e gera webhookSecret na criação', async () => {
    const svc = new SonaxSettingsService(prisma, crypto);
    const saved = await svc.upsert('org1', { enabled: true, idCliente: '12345', token: 'TK20' });
    expect(saved.tokenEnc).toBe('enc(TK20)');
    expect(saved.webhookSecret).toHaveLength(40);
  });

  it('upsert preserva webhookSecret existente e não troca token quando ausente', async () => {
    const svc = new SonaxSettingsService(prisma, crypto);
    const first = await svc.upsert('org1', { enabled: true, idCliente: '12345', token: 'TK20' });
    const second = await svc.upsert('org1', { enabled: false, idCliente: '12345' });
    expect(second.webhookSecret).toBe(first.webhookSecret);
    expect(second.tokenEnc).toBe('enc(TK20)');
  });

  it('getDecryptedForDial devolve token em claro só para uso interno', async () => {
    const svc = new SonaxSettingsService(prisma, crypto);
    await svc.upsert('org1', { enabled: true, idCliente: '12345', token: 'TK20' });
    const d = await svc.getDecryptedForDial('org1');
    expect(d?.token).toBe('TK20');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/calls/sonax-settings.service.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

export interface UpsertSonaxInput {
  enabled: boolean;
  idCliente: string;
  token?: string; // ausente = mantém o token atual
  click2callBaseUrl?: string;
}

@Injectable()
export class SonaxSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async get(organizationId: string) {
    return this.prisma.sonaxSettings.findUnique({ where: { organizationId } });
  }

  async upsert(organizationId: string, input: UpsertSonaxInput) {
    const existing = await this.prisma.sonaxSettings.findUnique({ where: { organizationId } });
    const webhookSecret = existing?.webhookSecret ?? randomBytes(20).toString('hex');
    const tokenEnc = input.token ? this.crypto.encrypt(input.token) : existing?.tokenEnc;
    if (!tokenEnc) {
      throw new Error('Token Sonax obrigatório na primeira configuração');
    }
    return this.prisma.sonaxSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        enabled: input.enabled,
        idCliente: input.idCliente,
        tokenEnc,
        webhookSecret,
        ...(input.click2callBaseUrl ? { click2callBaseUrl: input.click2callBaseUrl } : {}),
      },
      update: {
        enabled: input.enabled,
        idCliente: input.idCliente,
        tokenEnc,
        ...(input.click2callBaseUrl ? { click2callBaseUrl: input.click2callBaseUrl } : {}),
      },
    });
  }

  /** Uso INTERNO (disparo). Nunca exponha o retorno em resposta de API. */
  async getDecryptedForDial(organizationId: string) {
    const s = await this.get(organizationId);
    if (!s || !s.enabled) return null;
    return {
      idCliente: s.idCliente,
      token: this.crypto.decrypt(s.tokenEnc),
      click2callBaseUrl: s.click2callBaseUrl,
    };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/calls/sonax-settings.service.spec.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/calls/sonax-settings.service.ts src/modules/calls/sonax-settings.service.spec.ts
git commit -m "feat(calls): SonaxSettingsService (config por org, token cripto)"
```

---

## Task 5: `CallsService.initiateCall`

**Files:**
- Create: `src/modules/calls/calls.service.ts`
- Test: `src/modules/calls/calls.service.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { BadRequestException, BadGatewayException } from '@nestjs/common';
import { CallsService } from './calls.service';

function makeDeps(over: any = {}) {
  const created: any = {};
  const prisma = {
    conversation: {
      findFirst: jest.fn(async () => over.conversation ?? {
        id: 'conv1', organizationId: 'org1',
        contact: { phone: '11999998888' },
      }),
    },
    userOrganization: {
      findUnique: jest.fn(async () => over.member ?? { sonaxRamal: '101' }),
    },
    call: {
      create: jest.fn(async ({ data }) => { created.call = { id: 'call1', ...data }; return created.call; }),
      update: jest.fn(async ({ data }) => { created.callUpdate = data; return { id: 'call1', ...data }; }),
    },
    message: {
      create: jest.fn(async ({ data }) => ({ id: 'msg1', ...data })),
      update: jest.fn(async ({ data }) => ({ id: 'msg1', ...data })),
    },
  } as any;
  const settings = {
    getDecryptedForDial: jest.fn(async () => over.dial ?? { idCliente: '1', token: 'TK', click2callBaseUrl: 'https://x' }),
  } as any;
  const sonax = { click2call: jest.fn(async () => undefined), ...over.sonax } as any;
  const realtime = { emitToConversation: jest.fn() } as any;
  return { prisma, settings, sonax, realtime, created, svc: new CallsService(prisma, settings, sonax, realtime) };
}

describe('CallsService.initiateCall', () => {
  it('cria Call DIALING + Message SYSTEM e dispara o click2call com var_1=call.id', async () => {
    const d = makeDeps();
    const res = await d.svc.initiateCall('conv1', 'user1', 'org1');
    expect(res.status).toBe('DIALING');
    expect(d.sonax.click2call).toHaveBeenCalledWith(expect.objectContaining({ ramal: '101', var1: 'call1', numero: '5511999998888' }));
    expect(d.prisma.message.create).toHaveBeenCalled();
  });

  it('400 quando a conversa não tem telefone', async () => {
    const d = makeDeps({ conversation: { id: 'conv1', organizationId: 'org1', contact: { phone: null } } });
    await expect(d.svc.initiateCall('conv1', 'user1', 'org1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 quando Sonax não está habilitada', async () => {
    const d = makeDeps({ dial: null });
    await expect(d.svc.initiateCall('conv1', 'user1', 'org1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400 quando o atendente não tem ramal', async () => {
    const d = makeDeps({ member: { sonaxRamal: null } });
    await expect(d.svc.initiateCall('conv1', 'user1', 'org1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('502 e marca Call FAILED quando a Sonax recusa', async () => {
    const d = makeDeps({ sonax: { click2call: jest.fn(async () => { throw new Error('Sonax 404'); }) } });
    await expect(d.svc.initiateCall('conv1', 'user1', 'org1')).rejects.toBeInstanceOf(BadGatewayException);
    expect(d.created.callUpdate.status).toBe('FAILED');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/calls/calls.service.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```ts
import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SonaxSettingsService } from './sonax-settings.service';
import { SonaxClient } from './sonax-client';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { normalizeBrazilNumber } from './phone.util';

@Injectable()
export class CallsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SonaxSettingsService,
    private readonly sonax: SonaxClient,
    private readonly realtime: RealtimeGateway,
  ) {}

  async initiateCall(conversationId: string, userId: string, organizationId: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
      include: { contact: true },
    });
    if (!conversation) throw new NotFoundException('Conversa não encontrada');

    const rawPhone = conversation.contact?.phone;
    if (!rawPhone) throw new BadRequestException('Conversa sem telefone para discar');
    const numero = normalizeBrazilNumber(rawPhone);

    const dial = await this.settings.getDecryptedForDial(organizationId);
    if (!dial) throw new BadRequestException('Sonax não configurada ou desabilitada nesta organização');

    const member = await this.prisma.userOrganization.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    if (!member?.sonaxRamal) {
      throw new BadRequestException('Configure seu ramal Sonax na tela de Membros antes de ligar');
    }

    // 1. Cria o registro + a mensagem SYSTEM espelhada.
    const call = await this.prisma.call.create({
      data: { organizationId, conversationId, agentId: userId, ramal: member.sonaxRamal, numero, status: 'DIALING' },
    });
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        direction: 'OUTBOUND',
        type: 'SYSTEM',
        senderId: userId,
        status: 'SENT',
        content: { kind: 'call', callId: call.id, status: 'DIALING' },
      },
    });
    await this.prisma.call.update({ where: { id: call.id }, data: { messageId: message.id } });
    this.realtime.emitToConversation(conversationId, 'message:new', { message });

    // 2. Dispara o click2call. Falha => marca FAILED e devolve 502.
    try {
      await this.sonax.click2call({
        baseUrl: dial.click2callBaseUrl,
        numero,
        ramal: member.sonaxRamal,
        token: dial.token,
        var1: call.id,
      });
    } catch (err) {
      await this.prisma.call.update({ where: { id: call.id }, data: { status: 'FAILED', endedAt: new Date() } });
      const failedContent = { kind: 'call', callId: call.id, status: 'FAILED' };
      await this.prisma.message.update({ where: { id: message.id }, data: { content: failedContent } });
      this.realtime.emitToConversation(conversationId, 'message:update', { messageId: message.id, content: failedContent });
      throw new BadGatewayException('Falha ao iniciar a ligação na Sonax');
    }

    return { callId: call.id, status: 'DIALING' as const };
  }
}
```

> **Nota:** confirme o nome do include do contato na `Conversation` (`contact`) e o campo do telefone (`phone`). Se no schema o telefone estiver em outro campo/relação (ex.: `contact.phones[0]` ou `waId`), ajuste `rawPhone` de acordo — rode `grep -n "model Contact" prisma/schema.prisma` antes.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/calls/calls.service.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/calls/calls.service.ts src/modules/calls/calls.service.spec.ts
git commit -m "feat(calls): CallsService.initiateCall (guardas + disparo + Message SYSTEM)"
```

---

## Task 6: Controllers + DTO + Module

**Files:**
- Create: `src/modules/calls/dto/upsert-sonax-settings.dto.ts`
- Create: `src/modules/calls/calls.controller.ts`
- Create: `src/modules/calls/sonax-settings.controller.ts`
- Create: `src/modules/calls/calls.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: DTO**

```ts
import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class UpsertSonaxSettingsDto {
  @IsBoolean() enabled: boolean;
  @IsString() @MinLength(1) idCliente: string;
  @IsOptional() @IsString() token?: string;
  @IsOptional() @IsString() click2callBaseUrl?: string;
}
```

- [ ] **Step 2: CallsController (`POST /conversations/:id/call`)**

Siga o padrão de auth do projeto (JWT + `@CurrentOrg('id')` + `@CurrentUser('id')`, como em `organizations.controller.ts`).

```ts
import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser } from '../../common/decorators';
import { CallsService } from './calls.service';

@ApiTags('Calls')
@UseGuards(JwtAuthGuard)
@Controller('conversations')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Post(':id/call')
  @ApiOperation({ summary: 'Inicia uma ligação click-to-call (Sonax) para o contato da conversa' })
  initiate(
    @Param('id') conversationId: string,
    @CurrentUser('id') userId: string,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.calls.initiateCall(conversationId, userId, orgId);
  }
}
```

> Confirme o import exato do guard/decorators olhando o topo de `src/modules/organizations/organizations.controller.ts`.

- [ ] **Step 3: SonaxSettingsController (`GET/PUT /organizations/settings/sonax`, RBAC OWNER/ADMIN)**

```ts
import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { Roles, CurrentOrg } from '../../common/decorators';
import { SonaxSettingsService } from './sonax-settings.service';
import { UpsertSonaxSettingsDto } from './dto/upsert-sonax-settings.dto';

@ApiTags('Calls')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations/settings/sonax')
export class SonaxSettingsController {
  constructor(
    private readonly service: SonaxSettingsService,
    private readonly config: ConfigService,
  ) {}

  private toPublic(s: any) {
    if (!s) return { enabled: false, idCliente: '', tokenConfigured: false, webhookUrl: null };
    const base = this.config.get<string>('APP_API_URL') ?? '';
    return {
      enabled: s.enabled,
      idCliente: s.idCliente,
      tokenConfigured: !!s.tokenEnc,
      click2callBaseUrl: s.click2callBaseUrl,
      webhookUrl: `${base}/api/v1/webhooks/sonax/${s.webhookSecret}?var_1=<ID_CHAMADA>&status=<STATUS_CHAMADA>&status_atend=<STATUS_ATENDIMENTO>&duracao=<DURACAO_CHAMADA>&url_gravacao=<URL_GRAVACAO>`,
    };
  }

  @Get()
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Config Sonax da organização (nunca devolve o token em claro)' })
  async get(@CurrentOrg('id') orgId: string) {
    return this.toPublic(await this.service.get(orgId));
  }

  @Put()
  @Roles('OWNER', 'ADMIN')
  @ApiOperation({ summary: 'Salva a config Sonax da organização' })
  async put(@CurrentOrg('id') orgId: string, @Body() dto: UpsertSonaxSettingsDto) {
    return this.toPublic(await this.service.upsert(orgId, dto));
  }
}
```

> Confirme o nome exato da env da URL pública da API (`APP_API_URL`/`APP_URL`) em `.env.production.example` e ajuste. A `webhookUrl` é só um texto pra copiar; a rota real é criada na Fatia 2.

- [ ] **Step 4: CallsModule + registro no AppModule**

```ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CallsService } from './calls.service';
import { SonaxSettingsService } from './sonax-settings.service';
import { SonaxClient } from './sonax-client';
import { CallsController } from './calls.controller';
import { SonaxSettingsController } from './sonax-settings.controller';

@Module({
  imports: [PrismaModule, CryptoModule, RealtimeModule],
  controllers: [CallsController, SonaxSettingsController],
  providers: [CallsService, SonaxSettingsService, SonaxClient],
  exports: [SonaxSettingsService],
})
export class CallsModule {}
```

Em `src/app.module.ts`, adicione `CallsModule` ao array `imports`.

> Confirme os nomes dos módulos importados (`CryptoModule`, `RealtimeModule`, `PrismaModule`) — rode `grep -rn "class CryptoModule\|class RealtimeModule\|class PrismaModule" src`. Se `CryptoService` não estiver num módulo próprio, providencie-o diretamente no `CallsModule`.

- [ ] **Step 5: Build + smoke**

Run: `npx tsc --noEmit` (ou `yarn build`)
Expected: sem erros de tipo. Rode `npx jest src/modules/calls` — todos verdes.

- [ ] **Step 6: Commit**

```bash
git add src/modules/calls src/app.module.ts
git commit -m "feat(calls): controllers + module (POST /conversations/:id/call, config Sonax)"
```

---

## Task 7: Ramal por atendente na tela de Membros (backend)

**Files:**
- Create: `src/modules/organizations/dto/update-member-ramal.dto.ts`
- Modify: `src/modules/organizations/organizations.service.ts`
- Modify: `src/modules/organizations/organizations.controller.ts`
- Test: `src/modules/organizations/organizations.service.spec.ts` (adicionar caso)

- [ ] **Step 1: DTO**

```ts
import { IsOptional, IsString, Matches } from 'class-validator';

export class UpdateMemberRamalDto {
  // aceita dígitos (ex.: "101"); vazio/null limpa o ramal.
  @IsOptional() @IsString() @Matches(/^\d{0,6}$/, { message: 'Ramal deve conter só dígitos (até 6)' })
  sonaxRamal?: string;
}
```

- [ ] **Step 2: Teste do service que falha**

Adicione em `organizations.service.spec.ts`:

```ts
it('updateMemberRamal grava o ramal do membro', async () => {
  // usa o mock de prisma já existente no arquivo; ajuste conforme o padrão local
  const res = await service.updateMemberRamal('org1', 'member1', { sonaxRamal: '101' });
  expect(res.sonaxRamal).toBe('101');
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx jest src/modules/organizations/organizations.service.spec.ts -t updateMemberRamal`
Expected: FAIL — método não existe.

- [ ] **Step 4: Implementar no service**

```ts
async updateMemberRamal(orgId: string, memberId: string, dto: { sonaxRamal?: string }) {
  const membership = await this.prisma.userOrganization.findFirst({
    where: { id: memberId, organizationId: orgId },
  });
  if (!membership) throw new NotFoundException('Membro não encontrado');
  return this.prisma.userOrganization.update({
    where: { id: membership.id },
    data: { sonaxRamal: dto.sonaxRamal?.trim() ? dto.sonaxRamal.trim() : null },
  });
}
```

> Confirme se `memberId` na tela corresponde a `UserOrganization.id` ou a `User.id` (olhe como `resetMemberPassword`/`updateMemberRole` resolvem o membro) e alinhe o `where`.

- [ ] **Step 5: Endpoint no controller**

Seguindo o padrão de `members/:memberId/password` (RBAC OWNER/ADMIN, ADMIN só sobre AGENT):

```ts
@Patch('members/:memberId/ramal')
@Roles('OWNER', 'ADMIN')
@ApiOperation({ summary: 'Define o ramal Sonax de um membro' })
updateMemberRamal(
  @CurrentOrg('id') orgId: string,
  @Param('memberId') memberId: string,
  @Body() dto: UpdateMemberRamalDto,
) {
  return this.service.updateMemberRamal(orgId, memberId, dto);
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npx jest src/modules/organizations/organizations.service.spec.ts -t updateMemberRamal`
Expected: PASS.

- [ ] **Step 7: Expor o ramal na listagem de membros**

Em `getMembers`, garanta que o `select`/retorno inclua `sonaxRamal` (para a UI mostrar o valor atual).

- [ ] **Step 8: Commit**

```bash
git add src/modules/organizations
git commit -m "feat(calls): ramal Sonax por membro (PATCH members/:id/ramal)"
```

---

## Task 8: Frontend — API client + botão 📞

**Files:**
- Create: `src/lib/api/calls.ts`
- Create: `src/features/inbox/components/call-button.tsx`
- Modify: `src/features/inbox/components/conversation-header.tsx`

- [ ] **Step 1: API client**

```ts
import { api } from '../api'; // ajuste o import ao wrapper real (src/lib/api.ts)

export async function initiateCall(conversationId: string): Promise<{ callId: string; status: string }> {
  const { data } = await api.post(`/conversations/${conversationId}/call`);
  return data;
}

export interface SonaxSettings {
  enabled: boolean;
  idCliente: string;
  tokenConfigured: boolean;
  click2callBaseUrl?: string;
  webhookUrl: string | null;
}
export async function getSonaxSettings(): Promise<SonaxSettings> {
  const { data } = await api.get('/organizations/settings/sonax');
  return data;
}
export async function saveSonaxSettings(body: Partial<SonaxSettings> & { token?: string }): Promise<SonaxSettings> {
  const { data } = await api.put('/organizations/settings/sonax', body);
  return data;
}
```

> Ajuste `api`/envelope conforme o projeto (memory: web usa envelope `{data, meta}` em alguns pontos).

- [ ] **Step 2: CallButton**

```tsx
'use client';
import { useState } from 'react';
import { Phone } from 'lucide-react';
import { initiateCall } from '@/lib/api/calls';

interface Props {
  conversationId: string;
  phone?: string | null;
  isGroup: boolean;
  canCall: boolean;        // Sonax on + atendente tem ramal
  disabledReason?: string; // tooltip quando !canCall
}

export function CallButton({ conversationId, phone, isGroup, canCall, disabledReason }: Props) {
  const [loading, setLoading] = useState(false);
  if (isGroup || !phone) return null; // escondido em grupo/sem número

  async function handleClick() {
    if (!canCall) return;
    if (!window.confirm('Iniciar ligação? Seu ramal Sonax vai tocar primeiro.')) return;
    setLoading(true);
    try {
      await initiateCall(conversationId);
    } catch (e: any) {
      window.alert(e?.response?.data?.message ?? 'Não foi possível iniciar a ligação.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!canCall || loading}
      title={!canCall ? disabledReason : 'Ligar para o cliente'}
      className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-full text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
    >
      <Phone className={loading ? 'h-4 w-4 animate-pulse' : 'h-4 w-4'} />
    </button>
  );
}
```

- [ ] **Step 3: Inserir no header**

Em `conversation-header.tsx`, dentro da barra de ações do header, renderize `<CallButton .../>`. Garanta `[&>*]:shrink-0` no wrapper da barra (pegadinha conhecida de vazamento). Derive `canCall` de um hook que lê `getSonaxSettings()` (enabled) + se o usuário atual tem `sonaxRamal` (vem do `/auth/me` ou da listagem de membros — use o que já estiver disponível no contexto de sessão). Se ainda não houver essa info no front, na Fatia 1 pode passar `canCall={settings.enabled}` e deixar o backend barrar por ramal com mensagem clara (o `alert` mostra o motivo).

- [ ] **Step 4: Verificação manual**

Rode o front (`next dev` no `chat-bullq-web`), abra uma conversa individual → o botão 📞 aparece; grupo → não aparece. Clicar sem Sonax configurada → alerta "Sonax não configurada".

- [ ] **Step 5: Commit**

```bash
git add src/lib/api/calls.ts src/features/inbox/components/call-button.tsx src/features/inbox/components/conversation-header.tsx
git commit -m "feat(calls): botão click-to-call no header da conversa"
```

---

## Task 9: Frontend — Card de ligação na timeline

**Files:**
- Create: `src/features/inbox/components/call-card.tsx`
- Modify: o componente que renderiza cada mensagem (ex.: `message-item.tsx`)

- [ ] **Step 1: CallCard**

```tsx
import { Phone } from 'lucide-react';

const LABELS: Record<string, string> = {
  DIALING: 'Ligação iniciada',
  RINGING: 'Chamando…',
  TALKING: 'Em conversa…',
  ANSWERED: 'Atendida',
  FINISHED: 'Ligação encerrada',
  NO_ANSWER: 'Não atendida',
  BUSY: 'Ocupado',
  FAILED: 'Falha ao iniciar',
};

function fmtDur(sec?: number) {
  if (!sec && sec !== 0) return null;
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}m${String(s).padStart(2, '0')}s`;
}

export function CallCard({ content, senderName }: { content: any; senderName?: string }) {
  const label = LABELS[content.status] ?? 'Ligação';
  const dur = fmtDur(content.durationSec);
  return (
    <div className="mx-auto my-2 flex max-w-sm items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
      <Phone className="h-4 w-4 text-emerald-600" />
      <span className="font-medium">📞 {label}</span>
      {senderName && <span className="text-slate-400">· {senderName}</span>}
      {dur && <span>· {dur}</span>}
      {content.recordingUrl && (
        <a href={content.recordingUrl} target="_blank" rel="noreferrer" className="text-emerald-700 underline">▶️ gravação</a>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Dispatch no renderer de mensagem**

No componente que renderiza uma mensagem, antes do render normal:

```tsx
if (message.type === 'SYSTEM' && message.content?.kind === 'call') {
  return <CallCard content={message.content} senderName={message.senderName} />;
}
```

- [ ] **Step 3: Verificação manual**

Com a Fatia 1, ao clicar 📞 (com Sonax mock/real configurada) o card "📞 Ligação iniciada" aparece na timeline. (A transição pra "Atendida · duração · gravação" vem na Fatia 2.)

- [ ] **Step 4: Commit**

```bash
git add src/features/inbox/components/call-card.tsx src/features/inbox/components/message-item.tsx
git commit -m "feat(calls): card de ligação na timeline (Message SYSTEM kind=call)"
```

---

## Task 10: Frontend — Config Sonax + Ramal em Membros

**Files:**
- Create: `src/features/settings/sonax/sonax-settings-page.tsx` (+ entrada no menu de Configurações)
- Modify: tela de Membros (adicionar campo "Ramal Sonax")

- [ ] **Step 1: Página de config Sonax**

Formulário (OWNER/ADMIN) com: toggle `enabled`, `idCliente`, `token` (campo password; placeholder "•••• configurado" quando `tokenConfigured`, só envia se digitado), e um bloco read-only com a `webhookUrl` + botão "Copiar". Usa `getSonaxSettings`/`saveSonaxSettings`.

```tsx
'use client';
import { useEffect, useState } from 'react';
import { getSonaxSettings, saveSonaxSettings, SonaxSettings } from '@/lib/api/calls';

export function SonaxSettingsPage() {
  const [s, setS] = useState<SonaxSettings | null>(null);
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { getSonaxSettings().then(setS); }, []);
  if (!s) return null;

  async function save() {
    setSaving(true);
    try {
      const next = await saveSonaxSettings({
        enabled: s!.enabled, idCliente: s!.idCliente, ...(token ? { token } : {}),
      });
      setS(next); setToken('');
    } finally { setSaving(false); }
  }

  return (
    <div className="max-w-xl space-y-4">
      <h2 className="text-lg font-semibold">Ligações (Sonax)</h2>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} />
        Ativar click-to-call
      </label>
      <div>
        <label className="block text-sm">ID Cliente</label>
        <input className="w-full rounded border p-2" value={s.idCliente} onChange={(e) => setS({ ...s, idCliente: e.target.value })} />
      </div>
      <div>
        <label className="block text-sm">Token da API</label>
        <input type="password" className="w-full rounded border p-2"
          placeholder={s.tokenConfigured ? '•••• configurado (deixe em branco p/ manter)' : 'cole o token da Sonax'}
          value={token} onChange={(e) => setToken(e.target.value)} />
      </div>
      {s.webhookUrl && (
        <div>
          <label className="block text-sm">URL de webhook (cole na Sonax, campo "URL de desligamento")</label>
          <div className="flex gap-2">
            <input readOnly className="w-full rounded border bg-slate-50 p-2 text-xs" value={s.webhookUrl} />
            <button type="button" onClick={() => navigator.clipboard.writeText(s.webhookUrl!)} className="rounded border px-3">Copiar</button>
          </div>
        </div>
      )}
      <button onClick={save} disabled={saving} className="rounded bg-emerald-600 px-4 py-2 text-white disabled:opacity-50">
        {saving ? 'Salvando…' : 'Salvar'}
      </button>
    </div>
  );
}
```

Adicione a entrada "Ligações (Sonax)" no menu de Configurações (visível a OWNER/ADMIN).

- [ ] **Step 2: Campo Ramal na tela de Membros**

Ao lado do ícone de chave (reset de senha), adicione um input inline "Ramal" por membro que chama `PATCH /organizations/members/:memberId/ramal` com `{ sonaxRamal }` no blur/salvar. Mostra o `sonaxRamal` atual vindo de `getMembers`.

- [ ] **Step 3: Verificação manual**

Configurar Sonax (enabled + idCliente + token) → salva, `tokenConfigured=true`, webhookUrl aparece. Definir ramal de um membro → persiste. Clicar 📞 numa conversa com ramal setado dispara a ligação.

- [ ] **Step 4: Commit**

```bash
git add src/features/settings
git commit -m "feat(calls): tela de config Sonax + ramal por membro"
```

---

## Self-Review (executar antes de encerrar a Fatia 1)

1. **Cobertura do spec (Fatia 1):** ramal por membro ✅ (Task 7,10), config Sonax cripto ✅ (Task 4,6,10), disparo backend ✅ (Task 5), Call+Message SYSTEM ✅ (Task 5), botão 📞 escondido em grupo/sem número ✅ (Task 8), card na timeline ✅ (Task 9). Webhook fica pra Fatia 2 (fora de escopo aqui).
2. **Placeholders:** confirmar os 3 pontos "> Nota" (campo de telefone do Contact, nomes de módulos importados, env da URL da API) durante a execução — não deixar como TODO no código final.
3. **Consistência de tipos:** `content.kind === 'call'`, `content.status` e `content.callId` iguais em `CallsService`, `CallCard` e webhook (Fatia 2). `messageId` gravado no `Call`. Eventos realtime: `message:new` e `message:update`.

## Deploy (Fatia 1)

- Rodar migração no VPS (a API migra no boot; confirmar `calls`/`sonax_settings` criados).
- Garantir `KEY_ENCRYPTION_SECRET` no `docker-compose.yml` do VPS (já existe pro menu de IA — pegadinha conhecida).
- E2E parcial: configurar Sonax + ramal → clicar 📞 → o ramal do atendente toca e a Sonax disca pro cliente. O card mostra "Ligação iniciada". (Status final/gravação = Fatia 2.)
