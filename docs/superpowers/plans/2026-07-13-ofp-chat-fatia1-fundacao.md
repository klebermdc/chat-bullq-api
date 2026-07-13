# OFP Chat (Baileys self-hosted) — Fatia 1: Fundação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar a fundação do canal "OFP Chat" (`WHATSAPP_OFP`) — enum, tabela de sessão, adapter completo implementando os ports existentes, e um serviço `gateway-ofp` mínimo (stub) — sem conectar nenhum número em produção.

**Architecture:** O adapter `ofp` no `chat-bullq-api` espelha o adapter `wasender` (mesma forma: http-client + message-mapper + inbound/outbound adapters + module), implementando `InboundChannelPort` e `OutboundChannelPort`. Ele fala HTTP com um serviço novo `gateway-ofp` (repo irmão, Node puro + Express) que nesta fatia é só um stub (`/health` + `/instances/:id/send` devolvendo um `externalId` fake). O core não muda: o adapter é registrado no `ChannelAdapterRegistry` via `onModuleInit`, exatamente como os outros. Validação de webhook usa HMAC-SHA256 (padrão do `whatsapp-official`), não a comparação simples do Wasender.

**Tech Stack:** NestJS + Prisma + Postgres + Jest (chat-bullq-api); Node 20 + Express + Jest + supertest (gateway-ofp); Docker Compose.

**Escopo desta fatia (e o que fica de fora):**
- ENTRA: enum `WHATSAPP_OFP`, tabela `ofp_sessions`, adapter `ofp` (mapper/http-client/inbound/outbound/module + registro), gateway-ofp stub (repo + Dockerfile + serviço no compose), testes unitários.
- FICA DE FORA (Fatias 2/3): Baileys real, auth state cifrado, connect/QR, gate de aviso na UI, aparição do "OFP Chat" no seletor de canais da web, rate-limit humanizado, reconexão. Nesta fatia **nada conecta** — a prova de que "o OFP Chat existe no core" é um teste do registry, não a UI.

**Convenções do projeto (respeitar):**
- Deploy é via **PR** na branch viva `feat/conversation-tabs`, nunca push direto. Esta fatia trabalha numa branch própria.
- `chat-bullq-api` e `gateway-ofp` são repositórios git **separados** (irmãos sob a pasta `Chat OFP/`).
- A API roda `prisma migrate deploy` no boot — migração aditiva é segura.
- Rodar comandos jest no `chat-bullq-api` a partir da raiz do repo da API.

---

## File Structure

**No repo `chat-bullq-api`:**
- Modify: `prisma/schema.prisma` — adiciona `WHATSAPP_OFP` ao enum `ChannelType` e o model `OfpSession`.
- Create: `prisma/migrations/<timestamp>_ofp_chat_foundation/migration.sql` — gerada pelo Prisma.
- Create: `src/modules/channel-hub/adapters/ofp/ofp.http-client.ts` — cliente HTTP fino para o gateway.
- Create: `src/modules/channel-hub/adapters/ofp/ofp.message-mapper.ts` — denormalize (saída) + normalizeInbound (entrada).
- Create: `src/modules/channel-hub/adapters/ofp/ofp.message-mapper.spec.ts` — testes do mapper.
- Create: `src/modules/channel-hub/adapters/ofp/ofp.outbound-adapter.ts` — implementa `OutboundChannelPort`.
- Create: `src/modules/channel-hub/adapters/ofp/ofp.inbound-adapter.ts` — implementa `InboundChannelPort` (HMAC).
- Create: `src/modules/channel-hub/adapters/ofp/ofp.inbound-adapter.spec.ts` — testes de HMAC/roteamento/parse.
- Create: `src/modules/channel-hub/adapters/ofp/ofp.module.ts` — módulo Nest do adapter.
- Modify: `src/modules/channel-hub/channel-hub.module.ts` — importa `OfpModule` e registra os adapters no `onModuleInit`.

**No repo novo `gateway-ofp` (irmão de `chat-bullq-api`):**
- Create: `gateway-ofp/package.json`
- Create: `gateway-ofp/tsconfig.json`
- Create: `gateway-ofp/jest.config.js`
- Create: `gateway-ofp/.gitignore`
- Create: `gateway-ofp/.dockerignore`
- Create: `gateway-ofp/src/app.ts` — cria o Express app (health + send stub).
- Create: `gateway-ofp/src/server.ts` — sobe o app numa porta.
- Create: `gateway-ofp/src/app.spec.ts` — testes com supertest.
- Create: `gateway-ofp/Dockerfile`
- Create: `gateway-ofp/README.md` — inclui o aviso de risco.

**Na pasta-pai `Chat OFP/` (não-versionada, gerenciada por deploy scripts):**
- Modify: `docker-compose.yml` — adiciona o serviço `gateway-ofp` e a env `GATEWAY_OFP_BASE_URL` no serviço `api`.

---

## Task 1: Branch de trabalho

**Files:** nenhum arquivo — só git.

- [ ] **Step 1: Criar branch no chat-bullq-api**

```bash
cd "chat-bullq-api"
git fetch fork 2>/dev/null || true
git checkout -b feat/ofp-chat-foundation
```

Expected: `Switched to a new branch 'feat/ofp-chat-foundation'`

---

## Task 2: Schema Prisma — enum + model OfpSession

**Files:**
- Modify: `prisma/schema.prisma` (enum `ChannelType` ~linha onde estão `WHATSAPP_OFFICIAL/ZAPPFY/WASENDER/INSTAGRAM`; novo model no fim da seção de models de canal)

- [ ] **Step 1: Adicionar o valor ao enum ChannelType**

Localize o bloco:

```prisma
enum ChannelType {
  WHATSAPP_OFFICIAL
  WHATSAPP_ZAPPFY
  WHATSAPP_WASENDER
  INSTAGRAM
}
```

E deixe assim:

```prisma
enum ChannelType {
  WHATSAPP_OFFICIAL
  WHATSAPP_ZAPPFY
  WHATSAPP_WASENDER
  WHATSAPP_OFP
  INSTAGRAM
}
```

- [ ] **Step 2: Adicionar o model OfpSession**

Adicione ao final do arquivo (junto dos outros models):

```prisma
/// Estado de sessão do gateway-ofp (Baileys self-hosted).
/// Acessado SOMENTE pelo serviço gateway-ofp. auth_state é cifrado (AES-256-GCM)
/// — NUNCA gravar em claro, NUNCA logar. Nesta fatia a tabela só existe;
/// o gateway real que a preenche vem na Fatia 2.
model OfpSession {
  id         String   @id @default(cuid())
  channelId  String   @unique @map("channel_id")
  authState  Bytes?   @map("auth_state")
  qrCode     String?  @map("qr_code")
  status     String   @default("disconnected")
  lastSeenAt DateTime? @map("last_seen_at")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@map("ofp_sessions")
}
```

- [ ] **Step 3: Gerar a migração e o client**

Run:
```bash
cd "chat-bullq-api"
npx prisma migrate dev --name ofp_chat_foundation
```
Expected: cria `prisma/migrations/<timestamp>_ofp_chat_foundation/migration.sql` com `ALTER TYPE "ChannelType" ADD VALUE 'WHATSAPP_OFP'` e `CREATE TABLE "ofp_sessions"`, e regenera o Prisma Client. Sem erro.

> Nota: `ALTER TYPE ... ADD VALUE` não roda dentro de transação em Postgres antigo; o Prisma gera isso corretamente numa migração própria. Se `migrate dev` reclamar de shadow DB, usar `npx prisma migrate dev --name ofp_chat_foundation --create-only` e depois `npx prisma migrate deploy` num banco local limpo.

- [ ] **Step 4: Verificar que o build TS enxerga o novo enum**

Run:
```bash
cd "chat-bullq-api"
npx tsc --noEmit -p tsconfig.json 2>&1 | head -20 || true
node -e "const {ChannelType}=require('@prisma/client'); console.log(ChannelType.WHATSAPP_OFP)"
```
Expected: imprime `WHATSAPP_OFP`. (Erros de tsc não relacionados podem existir no repo; o importante é o enum resolver.)

- [ ] **Step 5: Commit**

```bash
cd "chat-bullq-api"
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(ofp): schema WHATSAPP_OFP enum + ofp_sessions table"
```

---

## Task 3: HTTP client do adapter OFP

O client é fino: lê `config.instanceId` do canal e faz `POST {GATEWAY_OFP_BASE_URL}/instances/:instanceId/send`. Sem lógica de negócio (rate-limit é do gateway).

**Files:**
- Create: `src/modules/channel-hub/adapters/ofp/ofp.http-client.ts`

- [ ] **Step 1: Escrever o http-client**

```typescript
// src/modules/channel-hub/adapters/ofp/ofp.http-client.ts
import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';

/**
 * Cliente HTTP para o serviço gateway-ofp (Baileys self-hosted).
 *
 * O gateway roda na rede interna do compose, sem porta pública. A base URL
 * vem de GATEWAY_OFP_BASE_URL (ex.: http://gateway-ofp:8080). O `instanceId`
 * de cada número é o próprio channelId, guardado em `channel.config.instanceId`.
 */
@Injectable()
export class OfpHttpClient {
  private static readonly BASE_URL =
    process.env.GATEWAY_OFP_BASE_URL || 'http://gateway-ofp:8080';
  private readonly logger = new Logger(OfpHttpClient.name);

  private client(): AxiosInstance {
    return axios.create({
      baseURL: OfpHttpClient.BASE_URL,
      timeout: 30000,
    });
  }

  private instanceId(channel: Channel): string {
    const config = (channel.config ?? {}) as Record<string, any>;
    const id = config.instanceId ?? channel.id;
    return String(id);
  }

  async send(channel: Channel, payload: Record<string, any>): Promise<any> {
    const instanceId = this.instanceId(channel);
    try {
      const res = await this.client().post(
        `/instances/${instanceId}/send`,
        payload,
      );
      return res.data;
    } catch (error: any) {
      this.logger.error(
        `gateway-ofp send error (instance=${instanceId}): ${
          error.response?.data?.message || error.message
        }`,
      );
      throw error;
    }
  }
}
```

- [ ] **Step 2: Verificar que compila**

Run:
```bash
cd "chat-bullq-api"
npx tsc --noEmit src/modules/channel-hub/adapters/ofp/ofp.http-client.ts 2>&1 | grep -i "ofp.http-client" || echo "OK (sem erros no arquivo)"
```
Expected: `OK (sem erros no arquivo)`

- [ ] **Step 3: Commit**

```bash
cd "chat-bullq-api"
git add src/modules/channel-hub/adapters/ofp/ofp.http-client.ts
git commit -m "feat(ofp): http-client fino para o gateway-ofp"
```

---

## Task 4: Message mapper (denormalize saída + normalizeInbound entrada) — TDD

O mapper converte `NormalizedOutboundMessage` no payload do gateway (`denormalize`) e o evento do gateway em `NormalizedInboundMessage` (`normalizeInbound`).

**Contrato do gateway (definido aqui, implementado no gateway na Fatia 2):**
- **Saída** — body de `POST /instances/:id/send`:
  `{ to, type: 'text'|'media', text?, mediaUrl?, mimeType?, caption?, replyTo? }`
- **Entrada** — body do webhook `POST` que o gateway manda pro core:
  ```json
  {
    "event": "message",
    "instanceId": "<channelId>",
    "message": {
      "externalMessageId": "3EB0...",
      "from": "5511999998888",
      "fromMe": false,
      "pushName": "Fulano",
      "timestamp": 1752345600,
      "type": "text",
      "text": "oi",
      "mediaUrl": null,
      "mimeType": null,
      "caption": null
    }
  }
  ```
  `fromMe: true` = echo do celular pareado → entra como `isEcho: true`.

**Files:**
- Create: `src/modules/channel-hub/adapters/ofp/ofp.message-mapper.spec.ts`
- Create: `src/modules/channel-hub/adapters/ofp/ofp.message-mapper.ts`

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// src/modules/channel-hub/adapters/ofp/ofp.message-mapper.spec.ts
import { OfpMessageMapper } from './ofp.message-mapper';
import { MessageContentType } from '../../ports/types';

describe('OfpMessageMapper', () => {
  const mapper = new OfpMessageMapper();

  describe('denormalize (saída)', () => {
    it('mapeia texto para payload type=text', () => {
      const { endpoint, payload } = mapper.denormalize(
        { type: MessageContentType.TEXT, content: { text: 'olá' } },
        '5511999998888',
      );
      expect(endpoint).toBe('/send');
      expect(payload).toEqual({ to: '5511999998888', type: 'text', text: 'olá' });
    });

    it('mapeia imagem para payload type=media com caption', () => {
      const { payload } = mapper.denormalize(
        {
          type: MessageContentType.IMAGE,
          content: {
            mediaUrl: 'https://cdn.ofp/x.jpg',
            mimeType: 'image/jpeg',
            caption: 'legenda',
          },
        },
        '5511999998888',
      );
      expect(payload).toEqual({
        to: '5511999998888',
        type: 'media',
        mediaUrl: 'https://cdn.ofp/x.jpg',
        mimeType: 'image/jpeg',
        caption: 'legenda',
      });
    });

    it('inclui replyTo quando presente', () => {
      const { payload } = mapper.denormalize(
        {
          type: MessageContentType.TEXT,
          content: { text: 'resposta' },
          replyTo: { externalMessageId: 'ABC123' },
        },
        '5511999998888',
      );
      expect(payload.replyTo).toBe('ABC123');
    });
  });

  describe('normalizeInbound (entrada)', () => {
    const baseEvent = (over: Record<string, any> = {}) => ({
      event: 'message',
      instanceId: 'chan_1',
      message: {
        externalMessageId: '3EB0',
        from: '5511999998888',
        fromMe: false,
        pushName: 'Fulano',
        timestamp: 1752345600,
        type: 'text',
        text: 'oi',
        ...over,
      },
    });

    it('normaliza mensagem de texto recebida', () => {
      const n = mapper.normalizeInbound(baseEvent());
      expect(n).toBeTruthy();
      expect(n!.externalMessageId).toBe('3EB0');
      expect(n!.externalContactId).toBe('5511999998888');
      expect(n!.type).toBe(MessageContentType.TEXT);
      expect(n!.content.text).toBe('oi');
      expect(n!.isEcho).toBe(false);
      expect(n!.timestamp instanceof Date).toBe(true);
    });

    it('marca isEcho quando fromMe=true (echo do celular)', () => {
      const n = mapper.normalizeInbound(baseEvent({ fromMe: true }));
      expect(n!.isEcho).toBe(true);
    });

    it('normaliza mídia com mediaUrl e mimeType', () => {
      const n = mapper.normalizeInbound(
        baseEvent({
          type: 'media',
          text: null,
          mediaUrl: 'https://cdn.ofp/a.ogg',
          mimeType: 'audio/ogg',
          caption: null,
        }),
      );
      expect(n!.type).toBe(MessageContentType.AUDIO);
      expect(n!.content.mediaUrl).toBe('https://cdn.ofp/a.ogg');
      expect(n!.content.mimeType).toBe('audio/ogg');
    });

    it('devolve null para evento sem message', () => {
      expect(mapper.normalizeInbound({ event: 'status' })).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run:
```bash
cd "chat-bullq-api"
npx jest src/modules/channel-hub/adapters/ofp/ofp.message-mapper.spec.ts
```
Expected: FAIL — `Cannot find module './ofp.message-mapper'`.

- [ ] **Step 3: Implementar o mapper**

```typescript
// src/modules/channel-hub/adapters/ofp/ofp.message-mapper.ts
import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import {
  NormalizedOutboundMessage,
  NormalizedInboundMessage,
  MessageContentType,
} from '../../ports/types';

/**
 * Traduz entre o formato normalizado do core e o contrato HTTP do gateway-ofp.
 * O gateway já entrega o evento quase pronto — o mapper aqui é fino.
 */
@Injectable()
export class OfpMessageMapper {
  denormalize(
    message: NormalizedOutboundMessage,
    contactExternalId: string,
  ): { endpoint: string; payload: Record<string, any> } {
    const to = contactExternalId.replace(/@s\.whatsapp\.net|@g\.us|@lid/g, '');
    const { content, type, replyTo } = message;

    const payload: Record<string, any> =
      type === MessageContentType.TEXT
        ? { to, type: 'text', text: content.text ?? '' }
        : {
            to,
            type: 'media',
            mediaUrl: content.mediaUrl,
            mimeType: content.mimeType,
            caption: content.caption ?? content.text ?? undefined,
          };

    if (replyTo?.externalMessageId) {
      payload.replyTo = replyTo.externalMessageId;
    }

    return { endpoint: '/send', payload };
  }

  normalizeInbound(event: any): NormalizedInboundMessage | null {
    const m = event?.message;
    if (!m || !m.externalMessageId) return null;

    const type = this.mapType(m.type, m.mimeType);
    const timestamp = m.timestamp
      ? new Date(Number(m.timestamp) * 1000)
      : new Date();

    return {
      externalMessageId: String(m.externalMessageId),
      externalContactId: String(m.from ?? ''),
      contactName: m.pushName ?? undefined,
      contactPhone: m.from ? String(m.from) : undefined,
      channelType: ChannelType.WHATSAPP_OFP,
      timestamp,
      type,
      content: {
        text: m.text ?? undefined,
        mediaUrl: m.mediaUrl ?? undefined,
        mimeType: m.mimeType ?? undefined,
        caption: m.caption ?? undefined,
      },
      isEcho: Boolean(m.fromMe),
      rawPayload: event,
    };
  }

  private mapType(type: string, mimeType?: string): MessageContentType {
    if (type === 'text') return MessageContentType.TEXT;
    if (type === 'media') {
      const mt = String(mimeType ?? '');
      if (mt.startsWith('image/')) return MessageContentType.IMAGE;
      if (mt.startsWith('audio/')) return MessageContentType.AUDIO;
      if (mt.startsWith('video/')) return MessageContentType.VIDEO;
      return MessageContentType.DOCUMENT;
    }
    return MessageContentType.TEXT;
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run:
```bash
cd "chat-bullq-api"
npx jest src/modules/channel-hub/adapters/ofp/ofp.message-mapper.spec.ts
```
Expected: PASS (todos os testes verdes).

- [ ] **Step 5: Commit**

```bash
cd "chat-bullq-api"
git add src/modules/channel-hub/adapters/ofp/ofp.message-mapper.ts src/modules/channel-hub/adapters/ofp/ofp.message-mapper.spec.ts
git commit -m "feat(ofp): message-mapper (denormalize + normalizeInbound) com testes"
```

---

## Task 5: Outbound adapter (implementa OutboundChannelPort)

**Files:**
- Create: `src/modules/channel-hub/adapters/ofp/ofp.outbound-adapter.ts`

- [ ] **Step 1: Escrever o outbound adapter**

```typescript
// src/modules/channel-hub/adapters/ofp/ofp.outbound-adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import { ChannelType, Channel } from '@prisma/client';
import { OutboundChannelPort } from '../../ports/outbound-channel.port';
import {
  NormalizedOutboundMessage,
  SendResult,
  RateLimitConfig,
} from '../../ports/types';
import { OfpMessageMapper } from './ofp.message-mapper';
import { OfpHttpClient } from './ofp.http-client';

@Injectable()
export class OfpOutboundAdapter implements OutboundChannelPort {
  readonly channelType = ChannelType.WHATSAPP_OFP;
  private readonly logger = new Logger(OfpOutboundAdapter.name);

  constructor(
    private readonly mapper: OfpMessageMapper,
    private readonly httpClient: OfpHttpClient,
  ) {}

  async sendMessage(
    channel: Channel,
    contactExternalId: string,
    message: NormalizedOutboundMessage,
  ): Promise<SendResult> {
    const { payload } = this.mapper.denormalize(message, contactExternalId);
    const response = await this.httpClient.send(channel, payload);
    const data = response?.data ?? response;
    return {
      externalId: data?.externalId || data?.id || data?.key?.id || '',
      providerResponse: response,
    };
  }

  async sendTypingIndicator(
    channel: Channel,
    contactExternalId: string,
  ): Promise<void> {
    const to = contactExternalId.replace(/@s\.whatsapp\.net|@g\.us|@lid/g, '');
    try {
      await this.httpClient.send(channel, { to, type: 'presence', presence: 'composing' });
    } catch (error: any) {
      this.logger.warn(`Typing indicator failed: ${error.message}`);
    }
  }

  async getMediaUrl(_channel: Channel, mediaId: string): Promise<string> {
    // O gateway re-hospeda a mídia inbound e já entrega uma URL tocável.
    return mediaId;
  }

  async downloadMedia(_channel: Channel, _mediaId: string): Promise<Buffer> {
    // Não usado nesta fatia — o gateway entrega a mídia já re-hospedada.
    throw new Error('OFP downloadMedia not implemented in Fatia 1');
  }

  async resolveInboundMediaUrl(
    _channel: Channel,
    hint: { externalMessageId: string; mediaId?: string; mimeType?: string },
  ): Promise<{ fileUrl: string; mimeType?: string }> {
    // A mídia já vem re-hospedada no evento (mediaUrl do nosso domínio); echo.
    return { fileUrl: hint.mediaId ?? '', mimeType: hint.mimeType };
  }

  async deleteMessage(
    channel: Channel,
    externalMessageId: string,
  ): Promise<void> {
    // Baileys apaga-para-todos — habilitado (diferente do Cloud API).
    await this.httpClient.send(channel, {
      type: 'delete',
      externalMessageId,
    });
  }

  getRateLimits(): RateLimitConfig {
    return { maxPerSecond: 1, maxPerMinute: 20, windowMs: 60000 };
  }
}
```

- [ ] **Step 2: Verificar que compila**

Run:
```bash
cd "chat-bullq-api"
npx tsc --noEmit src/modules/channel-hub/adapters/ofp/ofp.outbound-adapter.ts 2>&1 | grep -i "ofp.outbound" || echo "OK (sem erros no arquivo)"
```
Expected: `OK (sem erros no arquivo)`

- [ ] **Step 3: Commit**

```bash
cd "chat-bullq-api"
git add src/modules/channel-hub/adapters/ofp/ofp.outbound-adapter.ts
git commit -m "feat(ofp): outbound-adapter implementando OutboundChannelPort"
```

---

## Task 6: Inbound adapter (implementa InboundChannelPort, HMAC) — TDD

Valida webhook com HMAC-SHA256 (padrão do `whatsapp-official`), roteia por `config.instanceId` e delega o parse ao mapper.

**Files:**
- Create: `src/modules/channel-hub/adapters/ofp/ofp.inbound-adapter.spec.ts`
- Create: `src/modules/channel-hub/adapters/ofp/ofp.inbound-adapter.ts`

- [ ] **Step 1: Escrever o teste que falha**

```typescript
// src/modules/channel-hub/adapters/ofp/ofp.inbound-adapter.spec.ts
import * as crypto from 'crypto';
import { OfpInboundAdapter } from './ofp.inbound-adapter';
import { OfpMessageMapper } from './ofp.message-mapper';
import { Channel } from '@prisma/client';

const makeChannel = (over: Partial<Channel> = {}): Channel =>
  ({
    id: 'chan_1',
    config: { instanceId: 'chan_1' },
    webhookSecret: 'topsecret',
    ...over,
  } as unknown as Channel);

const sign = (secret: string, body: Buffer) =>
  'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');

describe('OfpInboundAdapter', () => {
  const adapter = new OfpInboundAdapter(new OfpMessageMapper());

  it('extractLocators lê instanceId do envelope', () => {
    const locators = adapter.extractLocators(
      { instanceId: 'chan_1', message: {} },
      {},
    );
    expect(locators[0].instanceId).toBe('chan_1');
  });

  it('matchesChannel casa por instanceId', () => {
    const ch = makeChannel();
    expect(adapter.matchesChannel(ch, { instanceId: 'chan_1' })).toBe(true);
    expect(adapter.matchesChannel(ch, { instanceId: 'outro' })).toBe(false);
  });

  it('validateWebhook aceita HMAC correto', () => {
    const body = Buffer.from(JSON.stringify({ event: 'message' }));
    const headers = { 'x-ofp-signature': sign('topsecret', body) };
    expect(adapter.validateWebhook(headers, body, 'topsecret')).toBe(true);
  });

  it('validateWebhook rejeita HMAC errado', () => {
    const body = Buffer.from(JSON.stringify({ event: 'message' }));
    const headers = { 'x-ofp-signature': sign('chaveerrada', body) };
    expect(adapter.validateWebhook(headers, body, 'topsecret')).toBe(false);
  });

  it('validateWebhook rejeita quando falta assinatura', () => {
    const body = Buffer.from('{}');
    expect(adapter.validateWebhook({}, body, 'topsecret')).toBe(false);
  });

  it('parseWebhook devolve a mensagem normalizada', () => {
    const payload = {
      event: 'message',
      instanceId: 'chan_1',
      message: {
        externalMessageId: '3EB0',
        from: '5511999998888',
        fromMe: false,
        type: 'text',
        text: 'oi',
        timestamp: 1752345600,
      },
    };
    const result = adapter.parseWebhook(payload, makeChannel());
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].externalMessageId).toBe('3EB0');
    expect(result.statuses).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run:
```bash
cd "chat-bullq-api"
npx jest src/modules/channel-hub/adapters/ofp/ofp.inbound-adapter.spec.ts
```
Expected: FAIL — `Cannot find module './ofp.inbound-adapter'`.

- [ ] **Step 3: Implementar o inbound adapter**

```typescript
// src/modules/channel-hub/adapters/ofp/ofp.inbound-adapter.ts
import { Injectable, Logger } from '@nestjs/common';
import { Channel, ChannelType } from '@prisma/client';
import * as crypto from 'crypto';
import {
  InboundChannelPort,
  ChannelLocator,
} from '../../ports/inbound-channel.port';
import { WebhookParseResult, VerificationResponse } from '../../ports/types';
import { OfpMessageMapper } from './ofp.message-mapper';

@Injectable()
export class OfpInboundAdapter implements InboundChannelPort {
  readonly channelType = ChannelType.WHATSAPP_OFP;
  private readonly logger = new Logger(OfpInboundAdapter.name);

  constructor(private readonly mapper: OfpMessageMapper) {}

  extractLocators(
    payload: unknown,
    _headers: Record<string, string>,
  ): ChannelLocator[] {
    const event = (payload ?? {}) as Record<string, any>;
    const instanceId = event?.instanceId ?? event?.instance_id;
    if (instanceId == null) return [];
    return [{ instanceId: String(instanceId) }];
  }

  matchesChannel(channel: Channel, locator: ChannelLocator): boolean {
    const config = (channel.config ?? {}) as Record<string, any>;
    const configInstance = config.instanceId ?? channel.id;
    if (!locator.instanceId) return false;
    return String(configInstance) === String(locator.instanceId);
  }

  validateWebhook(
    headers: Record<string, string>,
    rawBody: Buffer,
    webhookSecret?: string,
    channel?: Channel,
  ): boolean {
    if (!webhookSecret) {
      this.logger.warn(
        `OFP channel ${channel?.id} sem webhookSecret — rejeitando webhook`,
      );
      return false;
    }
    const signature = headers['x-ofp-signature'];
    if (!signature) return false;

    const expected =
      'sha256=' +
      crypto.createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    try {
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected),
      );
    } catch {
      return false;
    }
  }

  parseWebhook(payload: unknown, _channel?: Channel): WebhookParseResult {
    const result: WebhookParseResult = {
      messages: [],
      statuses: [],
      errors: [],
    };
    try {
      const event = payload as any;
      if (event?.event === 'message') {
        const normalized = this.mapper.normalizeInbound(event);
        if (normalized) result.messages.push(normalized);
      }
      // event === 'status' / 'connection' são tratados na Fatia 3.
    } catch (error: any) {
      this.logger.error(`Failed to parse OFP webhook: ${error.message}`);
      result.errors.push({
        code: 'PARSE_ERROR',
        message: error.message,
        rawData: payload,
      });
    }
    return result;
  }

  handleVerification(
    _query: Record<string, string>,
    _webhookSecret?: string,
  ): VerificationResponse {
    return { statusCode: 200, body: 'OK' };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run:
```bash
cd "chat-bullq-api"
npx jest src/modules/channel-hub/adapters/ofp/ofp.inbound-adapter.spec.ts
```
Expected: PASS (todos verdes).

- [ ] **Step 5: Commit**

```bash
cd "chat-bullq-api"
git add src/modules/channel-hub/adapters/ofp/ofp.inbound-adapter.ts src/modules/channel-hub/adapters/ofp/ofp.inbound-adapter.spec.ts
git commit -m "feat(ofp): inbound-adapter com validação HMAC e testes"
```

---

## Task 7: Módulo Nest do adapter OFP

**Files:**
- Create: `src/modules/channel-hub/adapters/ofp/ofp.module.ts`

- [ ] **Step 1: Escrever o módulo**

```typescript
// src/modules/channel-hub/adapters/ofp/ofp.module.ts
import { Module } from '@nestjs/common';
import { OfpInboundAdapter } from './ofp.inbound-adapter';
import { OfpOutboundAdapter } from './ofp.outbound-adapter';
import { OfpMessageMapper } from './ofp.message-mapper';
import { OfpHttpClient } from './ofp.http-client';

@Module({
  providers: [
    OfpInboundAdapter,
    OfpOutboundAdapter,
    OfpMessageMapper,
    OfpHttpClient,
  ],
  exports: [OfpInboundAdapter, OfpOutboundAdapter, OfpHttpClient],
})
export class OfpModule {}
```

- [ ] **Step 2: Commit**

```bash
cd "chat-bullq-api"
git add src/modules/channel-hub/adapters/ofp/ofp.module.ts
git commit -m "feat(ofp): módulo Nest do adapter OFP"
```

---

## Task 8: Registrar o adapter OFP no ChannelHubModule — TDD (integração)

**Files:**
- Modify: `src/modules/channel-hub/channel-hub.module.ts` (imports, construtor, `onModuleInit`)
- Create: `src/modules/channel-hub/adapters/ofp/ofp.registration.spec.ts`

- [ ] **Step 1: Escrever o teste de registro que falha**

```typescript
// src/modules/channel-hub/adapters/ofp/ofp.registration.spec.ts
import { ChannelType } from '@prisma/client';
import { ChannelAdapterRegistry } from '../../channel-adapter.registry';
import { OfpInboundAdapter } from './ofp.inbound-adapter';
import { OfpOutboundAdapter } from './ofp.outbound-adapter';
import { OfpMessageMapper } from './ofp.message-mapper';
import { OfpHttpClient } from './ofp.http-client';

describe('OFP adapter registration', () => {
  it('o registry resolve os adapters OFP após registro', () => {
    const registry = new ChannelAdapterRegistry();
    const mapper = new OfpMessageMapper();
    const inbound = new OfpInboundAdapter(mapper);
    const outbound = new OfpOutboundAdapter(mapper, new OfpHttpClient());

    registry.register(inbound, outbound);

    expect(registry.hasAdapter(ChannelType.WHATSAPP_OFP)).toBe(true);
    expect(registry.getInbound(ChannelType.WHATSAPP_OFP)).toBe(inbound);
    expect(registry.getOutbound(ChannelType.WHATSAPP_OFP)).toBe(outbound);
    expect(registry.getSupportedTypes()).toContain(ChannelType.WHATSAPP_OFP);
  });
});
```

- [ ] **Step 2: Rodar e ver passar (o registry já é genérico) — então tornar o teste significativo via wiring**

Run:
```bash
cd "chat-bullq-api"
npx jest src/modules/channel-hub/adapters/ofp/ofp.registration.spec.ts
```
Expected: PASS — este teste prova que os adapters OFP encaixam no registry. (O registry é agnóstico de tipo, então ele passa direto; serve de guarda contra regressão de assinatura dos ports.)

- [ ] **Step 3: Fazer o wiring real no ChannelHubModule**

Em `src/modules/channel-hub/channel-hub.module.ts`:

Adicionar aos imports (junto dos outros adapters):
```typescript
import { OfpModule } from './adapters/ofp/ofp.module';
import { OfpInboundAdapter } from './adapters/ofp/ofp.inbound-adapter';
import { OfpOutboundAdapter } from './adapters/ofp/ofp.outbound-adapter';
```

Adicionar `OfpModule` ao array `imports` do `@Module` (junto de `WasenderModule` etc.):
```typescript
    ZappfyModule,
    WasenderModule,
    WhatsAppOfficialModule,
    InstagramModule,
    OfpModule,
```

Adicionar `OfpModule` ao array `exports` do `@Module` (junto de `WasenderModule` etc.):
```typescript
    InstagramModule,
    ZappfyModule,
    WasenderModule,
    OfpModule,
```

Injetar no construtor (junto dos outros adapters, antes do `) {}`):
```typescript
    private readonly ofpInbound: OfpInboundAdapter,
    private readonly ofpOutbound: OfpOutboundAdapter,
```

Registrar no `onModuleInit` (junto dos outros `register(...)`):
```typescript
    this.registry.register(this.ofpInbound, this.ofpOutbound);
```

- [ ] **Step 4: Rodar a suíte do channel-hub e garantir verde**

Run:
```bash
cd "chat-bullq-api"
npx jest src/modules/channel-hub/adapters/ofp
```
Expected: PASS — todos os specs do OFP (mapper, inbound, registration) verdes.

- [ ] **Step 5: Build da API inteira (garante que o wiring não quebrou nada)**

Run:
```bash
cd "chat-bullq-api"
npm run build 2>&1 | tail -20
```
Expected: build conclui sem erros de TypeScript.

- [ ] **Step 6: Commit**

```bash
cd "chat-bullq-api"
git add src/modules/channel-hub/channel-hub.module.ts src/modules/channel-hub/adapters/ofp/ofp.registration.spec.ts
git commit -m "feat(ofp): registra adapter OFP no ChannelHubModule + teste de registro"
```

---

## Task 9: Serviço gateway-ofp — repo, app stub (health + send) — TDD

Novo repo irmão. Nesta fatia é um **stub**: `/health` e `/instances/:id/send` (devolve `externalId` fake). Sem Baileys.

**Files (no novo diretório `gateway-ofp/`, irmão de `chat-bullq-api/`):**
- Create: `gateway-ofp/package.json`
- Create: `gateway-ofp/tsconfig.json`
- Create: `gateway-ofp/jest.config.js`
- Create: `gateway-ofp/.gitignore`
- Create: `gateway-ofp/src/app.ts`
- Create: `gateway-ofp/src/server.ts`
- Create: `gateway-ofp/src/app.spec.ts`

- [ ] **Step 1: Inicializar o repo e a estrutura**

Run (a partir da pasta-pai `Chat OFP/`):
```bash
mkdir -p gateway-ofp/src
cd gateway-ofp
git init
```

- [ ] **Step 2: Escrever package.json**

```json
{
  "name": "gateway-ofp",
  "version": "0.1.0",
  "private": true,
  "description": "Gateway OFP Chat — WhatsApp Baileys self-hosted (uso não-oficial, ver README)",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "dev": "ts-node src/server.ts",
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.19.2"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.12",
    "@types/node": "^20.14.0",
    "@types/supertest": "^6.0.2",
    "jest": "^29.7.0",
    "supertest": "^7.0.0",
    "ts-jest": "^29.1.5",
    "ts-node": "^10.9.2",
    "typescript": "^5.4.5"
  }
}
```

- [ ] **Step 3: Escrever tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "**/*.spec.ts"]
}
```

- [ ] **Step 4: Escrever jest.config.js**

```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
};
```

- [ ] **Step 5: Escrever .gitignore**

```
node_modules
dist
*.log
.env
```

- [ ] **Step 6: Instalar dependências**

Run:
```bash
cd gateway-ofp
npm install
```
Expected: cria `node_modules` e `package-lock.json`, sem erro.

- [ ] **Step 7: Escrever o teste que falha**

```typescript
// gateway-ofp/src/app.spec.ts
import request from 'supertest';
import { createApp } from './app';

describe('gateway-ofp app (stub)', () => {
  const app = createApp();

  it('GET /health responde ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'gateway-ofp' });
  });

  it('POST /instances/:id/send devolve um externalId (stub)', async () => {
    const res = await request(app)
      .post('/instances/chan_1/send')
      .send({ to: '5511999998888', type: 'text', text: 'oi' });
    expect(res.status).toBe(200);
    expect(res.body.externalId).toMatch(/^stub-/);
    expect(res.body.instanceId).toBe('chan_1');
  });

  it('POST /instances/:id/send exige campo "to"', async () => {
    const res = await request(app)
      .post('/instances/chan_1/send')
      .send({ type: 'text', text: 'oi' });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 8: Rodar e ver falhar**

Run:
```bash
cd gateway-ofp
npx jest
```
Expected: FAIL — `Cannot find module './app'`.

- [ ] **Step 9: Implementar o app**

```typescript
// gateway-ofp/src/app.ts
import express, { Express, Request, Response } from 'express';

/**
 * gateway-ofp (Fatia 1: STUB).
 *
 * Ainda NÃO sobe sessões Baileys — apenas prova a fiação com a API:
 *  - GET  /health
 *  - POST /instances/:id/send  → devolve um externalId fake
 *
 * O Baileys real, auth state cifrado, connect/QR e webhook de inbound
 * chegam na Fatia 2.
 */
export function createApp(): Express {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'gateway-ofp' });
  });

  app.post('/instances/:id/send', (req: Request, res: Response) => {
    const { id } = req.params;
    const { to } = req.body ?? {};
    if (!to) {
      return res.status(400).json({ message: 'campo "to" é obrigatório' });
    }
    // STUB: não envia nada de verdade; devolve um id sintético determinístico
    // o bastante pra o adapter processar a resposta.
    const externalId = `stub-${id}-${Buffer.from(String(to)).toString('hex').slice(0, 8)}`;
    return res.json({ externalId, instanceId: id });
  });

  return app;
}
```

- [ ] **Step 10: Implementar o server**

```typescript
// gateway-ofp/src/server.ts
import { createApp } from './app';

const port = Number(process.env.PORT ?? 8080);
const app = createApp();

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`gateway-ofp (stub) ouvindo na porta ${port}`);
});
```

- [ ] **Step 11: Rodar e ver passar**

Run:
```bash
cd gateway-ofp
npx jest
```
Expected: PASS (3 testes verdes).

- [ ] **Step 12: Build**

Run:
```bash
cd gateway-ofp
npm run build
```
Expected: gera `dist/` sem erro de TypeScript.

- [ ] **Step 13: Commit**

```bash
cd gateway-ofp
git add -A
git commit -m "feat: gateway-ofp stub (health + send) com testes"
```

---

## Task 10: Dockerfile e README do gateway-ofp

**Files:**
- Create: `gateway-ofp/Dockerfile`
- Create: `gateway-ofp/.dockerignore`
- Create: `gateway-ofp/README.md`

- [ ] **Step 1: Escrever o Dockerfile**

```dockerfile
# gateway-ofp/Dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

- [ ] **Step 2: Escrever o .dockerignore**

```
node_modules
dist
*.log
.env
```

- [ ] **Step 3: Escrever o README com o aviso de risco**

```markdown
# gateway-ofp

Serviço Node standalone que hospeda conexões WhatsApp via **Baileys** (protocolo
não-oficial), por trás do canal "OFP Chat" (`WHATSAPP_OFP`). Roda na rede interna
do compose, sem porta pública — só o `chat-bullq-api` fala com ele.

## ⚠️ Aviso de risco (não-oficial)

Conexões via Baileys usam protocolo **não-oficial** e violam os Termos de Serviço
do WhatsApp. Números conectados assim **podem ser banidos pela Meta a qualquer
momento**, independentemente de volume ou boas práticas. Esta camada existe para
oferecer a opção com o risco **isolado e transparente** ao tenant — a operação
principal da OFP permanece na **Cloud API oficial**. O onboarding do canal exibe
esse aviso e **registra o aceite** do tenant antes de permitir a conexão.

## Estado atual (Fatia 1)

STUB: expõe `GET /health` e `POST /instances/:id/send` (devolve um `externalId`
fake). Ainda **não** sobe sessões Baileys nem persiste auth state. O gateway real
chega na Fatia 2.

## Rodar local

    npm install
    npm test        # jest
    npm run dev     # ts-node src/server.ts (porta 8080)
```

- [ ] **Step 4: Commit**

```bash
cd gateway-ofp
git add Dockerfile .dockerignore README.md
git commit -m "chore: Dockerfile + README (aviso de risco) do gateway-ofp"
```

---

## Task 11: Adicionar o serviço gateway-ofp ao docker-compose

O `docker-compose.yml` fica na pasta-pai `Chat OFP/` (não-versionado; deploy scripts o gerenciam). Adicionar o serviço na rede `internal` (sem porta pública) e wirar a env no serviço `api`.

**Files:**
- Modify: `docker-compose.yml` (pasta-pai)

- [ ] **Step 1: Adicionar o serviço gateway-ofp**

No `docker-compose.yml`, adicionar um novo serviço (irmão de `api`):

```yaml
  gateway-ofp:
    build:
      context: ./gateway-ofp
    container_name: chat-ofp-gateway-ofp
    restart: unless-stopped
    environment:
      PORT: "8080"
    networks:
      - internal
    # sem `ports:` — acessível só dentro da rede interna
```

- [ ] **Step 2: Wirar a base URL no serviço api**

No bloco `environment:` do serviço `api`, adicionar:

```yaml
      GATEWAY_OFP_BASE_URL: "http://gateway-ofp:8080"
```

- [ ] **Step 3: Validar a sintaxe do compose**

Run (a partir da pasta-pai):
```bash
docker compose config >/dev/null && echo "compose OK"
```
Expected: `compose OK` (sem erro de parsing). Se `docker` não estiver disponível na máquina local, validar por inspeção — este passo roda de verdade no VPS no deploy.

> Nota de deploy: o `docker-compose.yml` do VPS não é versionado. Ao levar a Fatia 1 para produção, replicar estes dois trechos no compose do VPS (ou estender o deploy script), e subir com `docker compose up -d --build gateway-ofp`. Nesta fatia o serviço é inerte (stub) — não afeta nada existente.

---

## Task 12: Fechamento da fatia

- [ ] **Step 1: Rodar toda a suíte de testes do OFP no chat-bullq-api**

Run:
```bash
cd "chat-bullq-api"
npx jest src/modules/channel-hub/adapters/ofp
```
Expected: PASS — mapper + inbound + registration verdes.

- [ ] **Step 2: Rodar a suíte do gateway-ofp**

Run:
```bash
cd gateway-ofp
npx jest
```
Expected: PASS — 3 testes verdes.

- [ ] **Step 3: Build final dos dois**

Run:
```bash
cd "chat-bullq-api" && npm run build 2>&1 | tail -5
cd ../gateway-ofp && npm run build 2>&1 | tail -5
```
Expected: ambos os builds sem erro.

- [ ] **Step 4: Abrir PR do chat-bullq-api (não mergear — segue a convenção de PR)**

Run:
```bash
cd "chat-bullq-api"
git push fork feat/ofp-chat-foundation
gh pr create --base feat/conversation-tabs --head feat/ofp-chat-foundation \
  --title "feat(ofp): Fatia 1 — fundação do canal OFP Chat (Baileys self-hosted)" \
  --body "Enum WHATSAPP_OFP + tabela ofp_sessions + adapter OFP (mapper/http-client/inbound/outbound/module) registrado no core + gateway-ofp stub. Nada conecta em prod nesta fatia. Migração aditiva. Testes unitários verdes."
```
Expected: PR criado, `MERGEABLE`. **Não mergear** — deploy é decisão do usuário.

---

## Critério de aceite da Fatia 1

- `ChannelType.WHATSAPP_OFP` existe e o Prisma Client o expõe.
- Tabela `ofp_sessions` criada por migração aditiva.
- Adapter OFP (inbound + outbound) implementa os ports e é resolvido pelo `ChannelAdapterRegistry` (`getInbound/getOutbound(WHATSAPP_OFP)`), provado por teste.
- `validateWebhook` valida HMAC-SHA256 corretamente (aceita assinatura certa, rejeita errada/ausente).
- `gateway-ofp` responde `/health` e `/instances/:id/send` (stub), com testes verdes, Dockerfile e serviço no compose (inerte).
- **Nada conecta** — nenhum número real, nenhum risco em produção.

---

## Self-Review (feita pelo autor do plano)

- **Cobertura do spec (Fatia 1):** enum ✓ (Task 2), tabela `ofp_sessions` ✓ (Task 2), adapter inbound/outbound/capabilities/HMAC ✓ (Tasks 3–7), registro no core ✓ (Task 8), gateway stub health+send ✓ (Tasks 9–10), serviço no compose ✓ (Task 11), testes unitários ✓ (Tasks 4/6/8/9). Aparição no seletor da UI foi **conscientemente movida para a Fatia 2** (onde vive o connect/QR) — anotado no cabeçalho.
- **Capabilities:** o port real (`OutboundChannelPort`) **não tem** objeto `TransportCapabilities` (isso é do prompt genérico, não do código real). Portanto a decisão de "supportsTemplates=false → cadência manda texto" é tratada onde a cadência decide, na **Fatia 3** — não referenciei nenhum tipo inexistente aqui.
- **Placeholders:** nenhum "TODO/TBD"; todo passo de código traz o código real.
- **Consistência de tipos/nomes:** `OfpMessageMapper.denormalize` retorna `{ endpoint, payload }` e é consumido assim no outbound (Task 5); `normalizeInbound` retorna `NormalizedInboundMessage | null` e é consumido no inbound/mapper spec; contrato do gateway (`/instances/:id/send`, header `x-ofp-signature`, envelope `{event,instanceId,message}`) é o mesmo em mapper, inbound-adapter, http-client e no stub do gateway.
