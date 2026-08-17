# Canal Messenger — Plano 1: Núcleo (receber e responder)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o OFP Chat receber e responder mensagens do Facebook Messenger como um canal de primeira classe do inbox, respeitando a janela de 24h.

**Architecture:** Adapter novo em `channel-hub/adapters/messenger/` espelhando o molde do Instagram, com duas funções idênticas (HMAC e handshake) extraídas para um util compartilhado `meta-shared/`. O gateway de webhook é genérico (`@Post(':channelType')`), então a rota nasce sozinha ao adicionar `MESSENGER` ao enum e registrar o adapter.

**Tech Stack:** NestJS, Prisma (PostgreSQL), Jest, axios, Meta Graph API v21.0 (`graph.facebook.com`).

**Spec:** `docs/superpowers/specs/2026-08-17-messenger-channel-design.md`

**Worktree:** `.wt-messenger-api`, branch `feat/messenger-channel` (base: `fork/feat/conversation-tabs`)

**Comando de teste:** `npm test -- <caminho>`

---

## Contexto que o implementador precisa saber

**O pipeline já é agnóstico de canal.** Depois que o adapter entrega uma
`NormalizedInboundMessage` na fila, tudo o mais (contato, conversa, Aline,
funil, cadência) já funciona sem alteração. O trabalho aqui é só o adapter e a
fiação.

**Não existe nenhum teste para os adapters hoje.** Por isso a Task 1 escreve um
teste de caracterização do Instagram ANTES de qualquer refatoração — sem ele, a
extração do util compartilhado seria feita às cegas em código que está no ar.

**Prazo real:** a partir de **30/08/2026** a Meta manda figurinha só com o tipo
`sticker`. Hoje ela manda `sticker` E `image` no mesmo payload. O mapper precisa
priorizar `sticker` para funcionar nas duas eras.

**Fora deste plano** (têm plano próprio): captura do referral de anúncio
(Plano 2) e sync do histórico da Página (Plano 3).

---

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/channel-hub/adapters/meta-shared/meta-signature.util.ts` | HMAC + handshake, compartilhado entre Instagram e Messenger |
| `src/modules/channel-hub/adapters/meta-shared/meta-signature.util.spec.ts` | Testes do util |
| `src/modules/channel-hub/adapters/messenger/messenger.message-mapper.ts` | Payload da Meta ↔ formato normalizado |
| `src/modules/channel-hub/adapters/messenger/messenger.message-mapper.spec.ts` | Testes do mapper |
| `src/modules/channel-hub/adapters/messenger/messenger.http-client.ts` | Chamadas ao `graph.facebook.com` |
| `src/modules/channel-hub/adapters/messenger/messenger.inbound-adapter.ts` | Porta de entrada (locator, validação, parse) |
| `src/modules/channel-hub/adapters/messenger/messenger.inbound-adapter.spec.ts` | Testes do inbound |
| `src/modules/channel-hub/adapters/messenger/messenger.outbound-adapter.ts` | Porta de saída (envio, typing, mídia) |
| `src/modules/channel-hub/adapters/messenger/messenger-contact-enricher.service.ts` | Nome e foto do contato via Graph |
| `src/modules/channel-hub/adapters/messenger/messenger.module.ts` | Wiring Nest |
| `src/modules/channel-hub/adapters/instagram/instagram.inbound-adapter.spec.ts` | Caracterização (Task 1) |
| `prisma/migrations/<timestamp>_add_messenger_channel_type/migration.sql` | Valor novo no enum |

**Modificar:**

| Arquivo | Mudança |
|---|---|
| `prisma/schema.prisma` | `MESSENGER` no enum `ChannelType` |
| `src/modules/channel-hub/ports/inbound-channel.port.ts` | `pageId?` no `ChannelLocator` |
| `src/modules/channel-hub/adapters/instagram/instagram.inbound-adapter.ts` | Usa o util compartilhado |
| `src/modules/channel-hub/channel-hub.module.ts` | Importa e registra o Messenger |
| `src/modules/messaging/pipeline/whatsapp-window-gate.service.ts` | Renomeado para `meta-window-gate.service.ts`, aceita `MESSENGER` |
| `src/modules/messaging/conversations/whatsapp-window.util.ts` | Ignora CTWA de 72h fora do WhatsApp |
| `src/modules/messaging/pipeline/inbound-message.processor.ts` | Enriquecimento de contato do Messenger |
| `src/modules/channels/channels.service.ts` | Libera criação do tipo `MESSENGER` |

---

## Task 1: Rede de segurança antes de refatorar o Instagram

O Instagram está no ar e não tem teste. Antes de extrair qualquer linha dele,
travamos o comportamento atual com um teste de caracterização.

**Files:**
- Create: `src/modules/channel-hub/adapters/instagram/instagram.inbound-adapter.spec.ts`

- [ ] **Step 1: Escrever o teste de caracterização**

```typescript
import * as crypto from 'crypto';
import { Channel } from '@prisma/client';
import { InstagramInboundAdapter } from './instagram.inbound-adapter';
import { InstagramMessageMapper } from './instagram.message-mapper';

const APP_SECRET = 'segredo-de-teste';

function makeChannel(config: Record<string, unknown>): Channel {
  return { id: 'ch_1', config } as unknown as Channel;
}

function sign(body: Buffer, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('InstagramInboundAdapter (caracterização)', () => {
  const adapter = new InstagramInboundAdapter(new InstagramMessageMapper());

  describe('validateWebhook', () => {
    it('aceita assinatura correta', () => {
      const body = Buffer.from('{"object":"instagram"}');
      const headers = { 'x-hub-signature-256': sign(body, APP_SECRET) };

      expect(
        adapter.validateWebhook(headers, body, undefined, makeChannel({ appSecret: APP_SECRET })),
      ).toBe(true);
    });

    it('recusa assinatura de outro segredo', () => {
      const body = Buffer.from('{"object":"instagram"}');
      const headers = { 'x-hub-signature-256': sign(body, 'outro-segredo') };

      expect(
        adapter.validateWebhook(headers, body, undefined, makeChannel({ appSecret: APP_SECRET })),
      ).toBe(false);
    });

    it('recusa quando o header nao veio', () => {
      const body = Buffer.from('{}');

      expect(
        adapter.validateWebhook({}, body, undefined, makeChannel({ appSecret: APP_SECRET })),
      ).toBe(false);
    });

    it('aceita sem validar quando o canal nao tem appSecret', () => {
      const body = Buffer.from('{}');

      expect(adapter.validateWebhook({}, body, undefined, makeChannel({}))).toBe(true);
    });
  });

  describe('handleVerification', () => {
    it('devolve o challenge quando o token bate', () => {
      const res = adapter.handleVerification(
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '12345' },
        'tok',
      );

      expect(res).toEqual({ statusCode: 200, body: '12345' });
    });

    it('recusa quando o token nao bate', () => {
      const res = adapter.handleVerification(
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': '12345' },
        'tok',
      );

      expect(res.statusCode).toBe(403);
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que passa**

Run: `npm test -- src/modules/channel-hub/adapters/instagram/instagram.inbound-adapter.spec.ts`
Expected: PASS (6 testes). Este teste descreve o comportamento que JÁ existe — se
falhar, pare e investigue antes de seguir.

- [ ] **Step 3: Commit**

```bash
git add src/modules/channel-hub/adapters/instagram/instagram.inbound-adapter.spec.ts
git commit -m "test(instagram): caracteriza assinatura e handshake antes da extracao"
```

---

## Task 2: Util compartilhado de assinatura e handshake

**Files:**
- Create: `src/modules/channel-hub/adapters/meta-shared/meta-signature.util.ts`
- Create: `src/modules/channel-hub/adapters/meta-shared/meta-signature.util.spec.ts`

- [ ] **Step 1: Escrever o teste do util**

```typescript
import * as crypto from 'crypto';
import { verifyMetaSignature, handleMetaVerification } from './meta-signature.util';

const SECRET = 'segredo-de-teste';

function sign(body: Buffer, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyMetaSignature', () => {
  it('aceita assinatura correta', () => {
    const body = Buffer.from('{"object":"page"}');
    expect(verifyMetaSignature({ 'x-hub-signature-256': sign(body, SECRET) }, body, SECRET)).toBe(true);
  });

  it('recusa assinatura de outro segredo', () => {
    const body = Buffer.from('{"object":"page"}');
    expect(verifyMetaSignature({ 'x-hub-signature-256': sign(body, 'outro') }, body, SECRET)).toBe(false);
  });

  it('recusa quando o header nao veio', () => {
    expect(verifyMetaSignature({}, Buffer.from('{}'), SECRET)).toBe(false);
  });

  it('aceita sem validar quando nao ha segredo configurado', () => {
    expect(verifyMetaSignature({}, Buffer.from('{}'), undefined)).toBe(true);
  });

  it('recusa assinatura de tamanho diferente sem estourar excecao', () => {
    expect(verifyMetaSignature({ 'x-hub-signature-256': 'sha256=abc' }, Buffer.from('{}'), SECRET)).toBe(false);
  });
});

describe('handleMetaVerification', () => {
  it('devolve o challenge quando o token bate', () => {
    expect(
      handleMetaVerification(
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '999' },
        'tok',
      ),
    ).toEqual({ statusCode: 200, body: '999' });
  });

  it('recusa token errado', () => {
    expect(
      handleMetaVerification(
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': '999' },
        'tok',
      ).statusCode,
    ).toBe(403);
  });

  it('recusa quando o mode nao e subscribe', () => {
    expect(
      handleMetaVerification(
        { 'hub.mode': 'unsubscribe', 'hub.verify_token': 'tok', 'hub.challenge': '999' },
        'tok',
      ).statusCode,
    ).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/modules/channel-hub/adapters/meta-shared/meta-signature.util.spec.ts`
Expected: FAIL — `Cannot find module './meta-signature.util'`

- [ ] **Step 3: Implementar o util**

```typescript
import * as crypto from 'crypto';
import { VerificationResponse } from '../../ports/types';

/**
 * Valida o `X-Hub-Signature-256` que a Meta envia em todo webhook.
 *
 * Compartilhado entre Instagram e Messenger: as duas plataformas usam
 * exatamente o mesmo esquema (HMAC-SHA256 do corpo cru com o App Secret).
 *
 * Sem `appSecret` configurado no canal, aceita sem validar — preserva o
 * comportamento historico do adapter do Instagram, onde o segredo e opcional.
 */
export function verifyMetaSignature(
  headers: Record<string, string>,
  rawBody: Buffer,
  appSecret?: string,
): boolean {
  if (!appSecret) return true;

  const signature = headers['x-hub-signature-256'];
  if (!signature) return false;

  const expected =
    'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    // timingSafeEqual estoura quando os buffers tem tamanhos diferentes.
    return false;
  }
}

/**
 * Handshake de verificacao do webhook (GET). A Meta manda `hub.mode`,
 * `hub.verify_token` e `hub.challenge`; devolvemos o challenge como texto puro
 * quando o token confere.
 */
export function handleMetaVerification(
  query: Record<string, string>,
  verifyToken?: string,
): VerificationResponse {
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];

  if (mode === 'subscribe' && token === verifyToken) {
    return { statusCode: 200, body: challenge };
  }

  return { statusCode: 403, body: { error: 'Verification failed' } };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/modules/channel-hub/adapters/meta-shared/meta-signature.util.spec.ts`
Expected: PASS (8 testes)

- [ ] **Step 5: Commit**

```bash
git add src/modules/channel-hub/adapters/meta-shared/
git commit -m "feat(channel-hub): util compartilhado de assinatura e handshake da Meta"
```

---

## Task 3: Instagram passa a usar o util

**Files:**
- Modify: `src/modules/channel-hub/adapters/instagram/instagram.inbound-adapter.ts`

- [ ] **Step 1: Trocar as duas implementações por chamadas ao util**

Adicione o import no topo do arquivo:

```typescript
import {
  verifyMetaSignature,
  handleMetaVerification,
} from '../meta-shared/meta-signature.util';
```

Substitua o corpo inteiro de `validateWebhook` por:

```typescript
  validateWebhook(
    headers: Record<string, string>,
    rawBody: Buffer,
    _webhookSecret?: string,
    channel?: Channel,
  ): boolean {
    const appSecret = (channel?.config as Record<string, any> | undefined)?.appSecret;
    return verifyMetaSignature(headers, rawBody, appSecret);
  }
```

Substitua o corpo inteiro de `handleVerification` por:

```typescript
  handleVerification(
    query: Record<string, string>,
    webhookSecret?: string,
  ): VerificationResponse {
    const result = handleMetaVerification(query, webhookSecret);
    if (result.statusCode === 200) {
      this.logger.log('Instagram webhook verification successful');
    } else {
      this.logger.warn('Instagram webhook verification failed');
    }
    return result;
  }
```

Remova o `import * as crypto from 'crypto';` — ele fica sem uso.

- [ ] **Step 2: Rodar o teste de caracterização**

Run: `npm test -- src/modules/channel-hub/adapters/instagram/instagram.inbound-adapter.spec.ts`
Expected: PASS (os mesmos 6 testes da Task 1). Este é o ponto do plano onde a
rede de segurança prova seu valor — comportamento idêntico, implementação nova.

- [ ] **Step 3: Verificar tipos**

Run: `npm run typecheck`
Expected: sem erros

- [ ] **Step 4: Commit**

```bash
git add src/modules/channel-hub/adapters/instagram/instagram.inbound-adapter.ts
git commit -m "refactor(instagram): usa o util compartilhado de assinatura/handshake"
```

---

## Task 4: Tipo de canal MESSENGER

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_messenger_channel_type/migration.sql`

> **Atenção — pegadinha conhecida deste projeto:** `ALTER TYPE ... ADD VALUE` e o
> uso desse valor **na mesma migração** quebram o `prisma migrate deploy`. Aqui
> só adicionamos o valor, sem usá-lo, então está seguro.

- [ ] **Step 1: Adicionar o valor ao enum**

Em `prisma/schema.prisma`, no enum `ChannelType`, acrescente `MESSENGER` após `INSTAGRAM`:

```prisma
enum ChannelType {
  WHATSAPP_OFFICIAL
  WHATSAPP_ZAPPFY
  // Integração removida do código. O valor FICA: canais e conversas antigos
  // no banco ainda apontam pra ele, e apagar o valor impediria de ler esses
  // registros. Criar canal novo desse tipo é barrado no ChannelsService.
  WHATSAPP_WASENDER
  INSTAGRAM
  MESSENGER
}
```

- [ ] **Step 2: Gerar a migração**

Run: `npx prisma migrate dev --name add_messenger_channel_type --create-only`
Expected: cria `prisma/migrations/<timestamp>_add_messenger_channel_type/migration.sql`
contendo `ALTER TYPE "ChannelType" ADD VALUE 'MESSENGER';`

- [ ] **Step 3: Regenerar o client**

Run: `npm run prisma:generate`
Expected: `✔ Generated Prisma Client`

- [ ] **Step 4: Verificar tipos**

Run: `npm run typecheck`
Expected: sem erros

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): tipo de canal MESSENGER"
```

---

## Task 5: Locator ganha o Page ID

**Files:**
- Modify: `src/modules/channel-hub/ports/inbound-channel.port.ts`

- [ ] **Step 1: Adicionar o campo**

No `ChannelLocator`, acrescente `pageId` e atualize o comentário:

```typescript
/**
 * Locator extracted from a webhook payload that uniquely identifies
 * which provider account/instance the event belongs to.
 *
 * - WA Official: { phoneNumberId, businessAccountId? }
 * - Instagram:   { igBusinessId }
 * - Messenger:   { pageId }
 * - Zappfy:      { instanceId?, token? }
 */
export interface ChannelLocator {
  phoneNumberId?: string;
  businessAccountId?: string;
  igBusinessId?: string;
  pageId?: string;
  instanceId?: string;
  token?: string;
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npm run typecheck`
Expected: sem erros (campo opcional, nada quebra)

- [ ] **Step 3: Commit**

```bash
git add src/modules/channel-hub/ports/inbound-channel.port.ts
git commit -m "feat(channel-hub): pageId no ChannelLocator"
```

---

## Task 6: Mapper — entrada de texto, mídia e figurinha

**Files:**
- Create: `src/modules/channel-hub/adapters/messenger/messenger.message-mapper.spec.ts`
- Create: `src/modules/channel-hub/adapters/messenger/messenger.message-mapper.ts`

- [ ] **Step 1: Escrever os testes de entrada**

```typescript
import { ChannelType } from '@prisma/client';
import { MessengerMessageMapper } from './messenger.message-mapper';
import { MessageContentType } from '../../ports/types';

describe('MessengerMessageMapper.normalizeInbound', () => {
  const mapper = new MessengerMessageMapper();

  it('normaliza mensagem de texto', () => {
    const result = mapper.normalizeInbound({
      sender: { id: 'PSID_1' },
      recipient: { id: 'PAGE_1' },
      timestamp: 1458692752478,
      message: { mid: 'm_abc', text: 'ola mundo' },
    });

    expect(result).toMatchObject({
      externalMessageId: 'm_abc',
      externalContactId: 'PSID_1',
      channelType: ChannelType.MESSENGER,
      type: MessageContentType.TEXT,
      content: { text: 'ola mundo' },
      isEcho: false,
    });
  });

  it('devolve null quando nao ha mensagem no evento', () => {
    expect(
      mapper.normalizeInbound({ sender: { id: 'PSID_1' }, recipient: { id: 'PAGE_1' } }),
    ).toBeNull();
  });

  it('em echo, o contato e o destinatario e nao o remetente', () => {
    const result = mapper.normalizeInbound({
      sender: { id: 'PAGE_1' },
      recipient: { id: 'PSID_1' },
      timestamp: 1458692752478,
      message: { mid: 'm_echo', text: 'resposta do atendente', is_echo: true },
    });

    expect(result?.externalContactId).toBe('PSID_1');
    expect(result?.isEcho).toBe(true);
  });

  it('normaliza imagem', () => {
    const result = mapper.normalizeInbound({
      sender: { id: 'PSID_1' },
      recipient: { id: 'PAGE_1' },
      timestamp: 1458692752478,
      message: {
        mid: 'm_img',
        attachments: [{ type: 'image', payload: { url: 'https://cdn.meta/x.jpg' } }],
      },
    });

    expect(result?.type).toBe(MessageContentType.IMAGE);
    expect(result?.content.mediaUrl).toBe('https://cdn.meta/x.jpg');
  });

  // A Meta manda figurinha com os DOIS tipos ate 30/08/2026; depois disso, so
  // `sticker`. Priorizamos `sticker` pra funcionar nas duas eras.
  it('trata figurinha no formato de transicao (sticker + image juntos)', () => {
    const result = mapper.normalizeInbound({
      sender: { id: 'PSID_1' },
      recipient: { id: 'PAGE_1' },
      timestamp: 1458692752478,
      message: {
        mid: 'm_stk',
        attachments: [
          { type: 'image', payload: { url: 'https://cdn.meta/s.png', sticker_id: 369239263222822 } },
          { type: 'sticker', payload: { url: 'https://cdn.meta/s.png', sticker_id: 369239263222822 } },
        ],
      },
    });

    expect(result?.type).toBe(MessageContentType.STICKER);
    expect(result?.content.mediaUrl).toBe('https://cdn.meta/s.png');
  });

  it('trata figurinha no formato pos-transicao (so sticker)', () => {
    const result = mapper.normalizeInbound({
      sender: { id: 'PSID_1' },
      recipient: { id: 'PAGE_1' },
      timestamp: 1458692752478,
      message: {
        mid: 'm_stk2',
        attachments: [{ type: 'sticker', payload: { url: 'https://cdn.meta/s.png' } }],
      },
    });

    expect(result?.type).toBe(MessageContentType.STICKER);
  });

  it('normaliza resposta de quick reply como INTERACTIVE', () => {
    const result = mapper.normalizeInbound({
      sender: { id: 'PSID_1' },
      recipient: { id: 'PAGE_1' },
      timestamp: 1458692752478,
      message: { mid: 'm_qr', text: 'Quero sim', quick_reply: { payload: 'SIM_QUERO' } },
    });

    expect(result?.type).toBe(MessageContentType.INTERACTIVE);
    expect(result?.content.interactive).toEqual({ type: 'quick_reply', payload: 'SIM_QUERO' });
    expect(result?.content.text).toBe('Quero sim');
  });

  it('guarda o mid citado quando a mensagem e resposta a outra', () => {
    const result = mapper.normalizeInbound({
      sender: { id: 'PSID_1' },
      recipient: { id: 'PAGE_1' },
      timestamp: 1458692752478,
      message: { mid: 'm_reply', text: 'isso', reply_to: { mid: 'm_original' } },
    });

    expect(result?.replyTo).toEqual({ externalMessageId: 'm_original' });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/modules/channel-hub/adapters/messenger/messenger.message-mapper.spec.ts`
Expected: FAIL — `Cannot find module './messenger.message-mapper'`

- [ ] **Step 3: Implementar a parte de entrada do mapper**

```typescript
import { Injectable } from '@nestjs/common';
import { ChannelType } from '@prisma/client';
import {
  NormalizedInboundMessage,
  NormalizedOutboundMessage,
  MessageContentType,
  StatusUpdate,
} from '../../ports/types';

/**
 * Tipos de anexo da Messenger Platform → nosso tipo de conteudo.
 * `sticker` vem antes de `image` de proposito: ate 30/08/2026 a Meta envia os
 * dois no mesmo payload, e queremos classificar como figurinha.
 */
const ATTACHMENT_TYPE_MAP: Record<string, MessageContentType> = {
  sticker: MessageContentType.STICKER,
  image: MessageContentType.IMAGE,
  audio: MessageContentType.AUDIO,
  video: MessageContentType.VIDEO,
  reel: MessageContentType.VIDEO,
  ig_reel: MessageContentType.VIDEO,
  file: MessageContentType.DOCUMENT,
  fallback: MessageContentType.TEXT,
  post: MessageContentType.TEXT,
  ig_post: MessageContentType.TEXT,
};

@Injectable()
export class MessengerMessageMapper {
  normalizeInbound(messaging: Record<string, any>): NormalizedInboundMessage | null {
    const senderId = messaging.sender?.id;
    const recipientId = messaging.recipient?.id;
    const message = messaging.message;
    if (!senderId || !message) return null;

    const isEcho = !!message.is_echo;
    // Em echo (mensagem que a Pagina enviou pelo app da Meta), o "contato" e o
    // destinatario — o remetente somos nos.
    const externalContactId = isEcho ? recipientId : senderId;
    if (!externalContactId) return null;

    const result: NormalizedInboundMessage = {
      externalMessageId: message.mid,
      externalContactId,
      channelType: ChannelType.MESSENGER,
      timestamp: new Date(messaging.timestamp),
      type: this.resolveContentType(message),
      content: this.extractContent(message),
      isEcho,
      rawPayload: messaging,
    };

    if (message.reply_to?.mid) {
      result.replyTo = { externalMessageId: String(message.reply_to.mid) };
    }

    return result;
  }

  private resolveContentType(msg: Record<string, any>): MessageContentType {
    if (msg.quick_reply) return MessageContentType.INTERACTIVE;

    const attachment = this.pickAttachment(msg);
    if (attachment) {
      return ATTACHMENT_TYPE_MAP[attachment.type] ?? MessageContentType.TEXT;
    }

    return MessageContentType.TEXT;
  }

  /**
   * Escolhe o anexo relevante. Durante a transicao de figurinha da Meta o
   * payload traz `image` E `sticker` descrevendo a MESMA figurinha — o
   * `sticker` ganha, senao a figurinha entraria no inbox como foto comum.
   */
  private pickAttachment(msg: Record<string, any>): Record<string, any> | null {
    const attachments: any[] = msg.attachments ?? [];
    if (attachments.length === 0) return null;
    return attachments.find((a) => a?.type === 'sticker') ?? attachments[0];
  }

  private extractContent(msg: Record<string, any>): NormalizedInboundMessage['content'] {
    if (msg.quick_reply) {
      return {
        text: msg.text,
        interactive: { type: 'quick_reply', payload: msg.quick_reply.payload },
      };
    }

    const attachment = this.pickAttachment(msg);
    if (attachment) {
      const payload = attachment.payload ?? {};
      switch (attachment.type) {
        case 'sticker':
          return { mediaUrl: payload.url, mimeType: 'image/png' };
        case 'image':
          return { mediaUrl: payload.url, mimeType: 'image/jpeg' };
        case 'audio':
          return { mediaUrl: payload.url, mimeType: 'audio/mp4' };
        case 'video':
        case 'reel':
        case 'ig_reel':
          return { mediaUrl: payload.url, mimeType: 'video/mp4' };
        case 'file':
          return { mediaUrl: payload.url, fileName: payload.name };
        case 'fallback':
          return { text: payload.title || payload.url || '[Conteudo compartilhado]' };
        default:
          return { text: msg.text || `[${attachment.type}]` };
      }
    }

    if (msg.text) return { text: msg.text };

    return { text: '[Mensagem nao suportada]' };
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/modules/channel-hub/adapters/messenger/messenger.message-mapper.spec.ts`
Expected: PASS (8 testes)

- [ ] **Step 5: Commit**

```bash
git add src/modules/channel-hub/adapters/messenger/
git commit -m "feat(messenger): mapper de entrada (texto, midia, figurinha, quick reply)"
```

---

## Task 7: Mapper — saída e status

**Files:**
- Modify: `src/modules/channel-hub/adapters/messenger/messenger.message-mapper.spec.ts`
- Modify: `src/modules/channel-hub/adapters/messenger/messenger.message-mapper.ts`

- [ ] **Step 1: Acrescentar os testes de saída e status**

Adicione ao final do arquivo de spec:

```typescript
describe('MessengerMessageMapper.denormalize', () => {
  const mapper = new MessengerMessageMapper();

  it('monta payload de texto', () => {
    const payload = mapper.denormalize(
      { type: MessageContentType.TEXT, content: { text: 'oi' } },
      'PSID_1',
    );

    expect(payload).toEqual({ recipient: { id: 'PSID_1' }, message: { text: 'oi' } });
  });

  it('monta payload de imagem', () => {
    const payload = mapper.denormalize(
      { type: MessageContentType.IMAGE, content: { mediaUrl: 'https://x/y.jpg' } },
      'PSID_1',
    );

    expect(payload).toEqual({
      recipient: { id: 'PSID_1' },
      message: {
        attachment: { type: 'image', payload: { url: 'https://x/y.jpg', is_reusable: true } },
      },
    });
  });

  // O Send API do Messenger nao tem reply nativo. Degradamos citando o trecho
  // no corpo, igual ao Instagram.
  it('prefixa citacao textual quando ha replyTo', () => {
    const payload = mapper.denormalize(
      {
        type: MessageContentType.TEXT,
        content: { text: 'claro!' },
        replyTo: { externalMessageId: 'm_1', previewText: 'tem vaga?', senderName: 'Ana' },
      },
      'PSID_1',
    );

    expect(payload.message.text).toBe('> Ana disse:\n> tem vaga?\n\nclaro!');
  });

  it('nao cita nada quando replyTo vem sem preview e sem nome', () => {
    const payload = mapper.denormalize(
      { type: MessageContentType.TEXT, content: { text: 'ok' }, replyTo: { externalMessageId: 'm_1' } },
      'PSID_1',
    );

    expect(payload.message.text).toBe('ok');
  });
});

describe('MessengerMessageMapper status', () => {
  const mapper = new MessengerMessageMapper();

  it('normaliza entrega', () => {
    expect(
      mapper.normalizeStatus({ timestamp: 1458692752478, delivery: { mids: ['m_1'] } }),
    ).toEqual({ externalMessageId: 'm_1', status: 'delivered', timestamp: new Date(1458692752478) });
  });

  it('devolve null quando entrega vem sem mids', () => {
    expect(mapper.normalizeStatus({ timestamp: 1, delivery: {} })).toBeNull();
  });

  it('normaliza leitura pelo watermark', () => {
    const result = mapper.normalizeReadStatus({ timestamp: 1, read: { watermark: 1458692752478 } });

    expect(result?.status).toBe('read');
    expect(result?.externalMessageId).toBe('messenger-read-watermark:1458692752478');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/modules/channel-hub/adapters/messenger/messenger.message-mapper.spec.ts`
Expected: FAIL — `mapper.denormalize is not a function`

- [ ] **Step 3: Implementar saída e status**

Acrescente estes métodos à classe `MessengerMessageMapper` e a função auxiliar ao final do arquivo:

```typescript
  normalizeStatus(messaging: Record<string, any>): StatusUpdate | null {
    const delivery = messaging.delivery;
    if (!delivery?.mids?.length) return null;

    return {
      externalMessageId: delivery.mids[0],
      status: 'delivered',
      timestamp: new Date(messaging.timestamp),
    };
  }

  /**
   * A Meta manda `read` com um `watermark` (sem mids): tudo que foi enviado ate
   * aquele instante foi lido. O processor faz a atualizacao em massa.
   */
  normalizeReadStatus(messaging: Record<string, any>): StatusUpdate | null {
    const read = messaging.read;
    if (!read?.watermark) return null;

    return {
      externalMessageId: `messenger-read-watermark:${read.watermark}`,
      status: 'read',
      timestamp: new Date(Number(read.watermark) || messaging.timestamp),
    };
  }

  denormalize(
    message: NormalizedOutboundMessage,
    contactExternalId: string,
  ): Record<string, any> {
    const base = { recipient: { id: contactExternalId } };

    const quotePrefix = buildQuotePrefix(message.replyTo);
    const withQuote = (text: string): string => (quotePrefix ? `${quotePrefix}${text}` : text);

    const asAttachment = (type: string) => ({
      ...base,
      message: {
        attachment: { type, payload: { url: message.content.mediaUrl, is_reusable: true } },
      },
    });

    switch (message.type) {
      case MessageContentType.IMAGE:
      case MessageContentType.STICKER:
        return asAttachment('image');
      case MessageContentType.AUDIO:
        return asAttachment('audio');
      case MessageContentType.VIDEO:
        return asAttachment('video');
      case MessageContentType.DOCUMENT:
        return asAttachment('file');
      default:
        return { ...base, message: { text: withQuote(message.content.text || '') } };
    }
  }
```

E, ao final do arquivo (fora da classe):

```typescript
/**
 * O Send API do Messenger nao suporta reply nativo. Degradamos citando o
 * trecho no corpo da mensagem — mesmo tratamento usado no Instagram.
 *
 *   > Ana disse:
 *   > tem vaga?
 *
 *   claro!
 *
 * Sem nome nem preview uteis, nao cita nada: melhor sem citacao do que
 * mostrar "> undefined" pro cliente.
 */
function buildQuotePrefix(replyTo: NormalizedOutboundMessage['replyTo']): string {
  if (!replyTo) return '';

  const sender = replyTo.senderName?.trim();
  let preview = replyTo.previewText?.trim() ?? '';
  if (!sender && !preview) return '';
  if (preview.length > 120) preview = preview.slice(0, 117) + '…';

  const senderLine = sender ? `> ${sender} disse:\n` : '';
  const previewLine = preview ? `> ${preview}\n\n` : '\n';
  return `${senderLine}${previewLine}`;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/modules/channel-hub/adapters/messenger/messenger.message-mapper.spec.ts`
Expected: PASS (15 testes)

- [ ] **Step 5: Commit**

```bash
git add src/modules/channel-hub/adapters/messenger/messenger.message-mapper.ts src/modules/channel-hub/adapters/messenger/messenger.message-mapper.spec.ts
git commit -m "feat(messenger): mapper de saida e status de entrega/leitura"
```

---

## Task 8: Cliente HTTP do Graph

**Files:**
- Create: `src/modules/channel-hub/adapters/messenger/messenger.http-client.ts`

- [ ] **Step 1: Implementar o cliente**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import axios, { AxiosInstance } from 'axios';

interface MessengerConfig {
  accessToken: string;
  pageId?: string;
  appSecret?: string;
  apiVersion: string;
}

export interface MessengerUserProfile {
  first_name?: string;
  last_name?: string;
  profile_pic?: string;
}

@Injectable()
export class MessengerHttpClient {
  private readonly logger = new Logger(MessengerHttpClient.name);

  private getConfig(channel: Channel): MessengerConfig {
    const config = (channel.config ?? {}) as Record<string, any>;
    return {
      accessToken: config.accessToken || config.pageAccessToken,
      pageId: config.pageId,
      appSecret: config.appSecret,
      apiVersion: config.apiVersion || 'v21.0',
    };
  }

  private createClient(channel: Channel): AxiosInstance {
    const cfg = this.getConfig(channel);
    return axios.create({
      // Messenger usa graph.facebook.com (o Instagram usa graph.instagram.com).
      baseURL: `https://graph.facebook.com/${cfg.apiVersion}`,
      params: { access_token: cfg.accessToken },
      timeout: 30000,
    });
  }

  async sendMessage(channel: Channel, payload: Record<string, any>): Promise<any> {
    const client = this.createClient(channel);
    try {
      const { data } = await client.post('/me/messages', payload);
      return data;
    } catch (err: unknown) {
      throw this.wrapGraphError(err, 'sendMessage');
    }
  }

  async getUserProfile(
    channel: Channel,
    psid: string,
  ): Promise<MessengerUserProfile | null> {
    const client = this.createClient(channel);
    try {
      const { data } = await client.get(`/${psid}`, {
        params: { fields: 'first_name,last_name,profile_pic' },
      });
      return data;
    } catch (err: unknown) {
      this.logger.warn(`getUserProfile falhou para ${psid}: ${this.describe(err)}`);
      return null;
    }
  }

  async downloadMedia(mediaUrl: string): Promise<Buffer> {
    const { data } = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
    });
    return Buffer.from(data);
  }

  /**
   * A Meta devolve o motivo real em `error.message`; sem isso o erro chega no
   * `failedReason` como "Request failed with status code 400" e o atendente
   * fica sem saber o que aconteceu.
   */
  private wrapGraphError(err: unknown, operation: string): Error {
    const response = (err as { response?: { data?: { error?: Record<string, any> } } })?.response;
    const metaError = response?.data?.error;
    if (metaError) {
      return new Error(
        `Messenger ${operation} falhou: ${metaError.message} ` +
          `(code=${metaError.code ?? 'n/a'}, subcode=${metaError.error_subcode ?? 'n/a'})`,
      );
    }
    return new Error(`Messenger ${operation} falhou: ${this.describe(err)}`);
  }

  private describe(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npm run typecheck`
Expected: sem erros

- [ ] **Step 3: Commit**

```bash
git add src/modules/channel-hub/adapters/messenger/messenger.http-client.ts
git commit -m "feat(messenger): cliente HTTP do Graph com motivo real do erro da Meta"
```

---

## Task 9: Adapter de entrada

**Files:**
- Create: `src/modules/channel-hub/adapters/messenger/messenger.inbound-adapter.spec.ts`
- Create: `src/modules/channel-hub/adapters/messenger/messenger.inbound-adapter.ts`

- [ ] **Step 1: Escrever os testes**

```typescript
import { Channel } from '@prisma/client';
import { MessengerInboundAdapter } from './messenger.inbound-adapter';
import { MessengerMessageMapper } from './messenger.message-mapper';

function makeChannel(config: Record<string, unknown>): Channel {
  return { id: 'ch_1', config } as unknown as Channel;
}

describe('MessengerInboundAdapter', () => {
  const adapter = new MessengerInboundAdapter(new MessengerMessageMapper());

  it('extrai o Page ID de cada entry, sem repetir', () => {
    const locators = adapter.extractLocators({
      object: 'page',
      entry: [{ id: 'PAGE_1' }, { id: 'PAGE_1' }, { id: 'PAGE_2' }],
    });

    expect(locators).toEqual([{ pageId: 'PAGE_1' }, { pageId: 'PAGE_2' }]);
  });

  it('casa o canal pelo pageId da config', () => {
    expect(adapter.matchesChannel(makeChannel({ pageId: 'PAGE_1' }), { pageId: 'PAGE_1' })).toBe(true);
    expect(adapter.matchesChannel(makeChannel({ pageId: 'PAGE_9' }), { pageId: 'PAGE_1' })).toBe(false);
  });

  it('nao casa quando o locator vem sem pageId', () => {
    expect(adapter.matchesChannel(makeChannel({ pageId: 'PAGE_1' }), {})).toBe(false);
  });

  it('extrai mensagens do envelope', () => {
    const result = adapter.parseWebhook(
      {
        object: 'page',
        entry: [
          {
            id: 'PAGE_1',
            messaging: [
              {
                sender: { id: 'PSID_1' },
                recipient: { id: 'PAGE_1' },
                timestamp: 1458692752478,
                message: { mid: 'm_1', text: 'oi' },
              },
            ],
          },
        ],
      },
      makeChannel({ pageId: 'PAGE_1' }),
    );

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].externalMessageId).toBe('m_1');
    expect(result.errors).toHaveLength(0);
  });

  it('descarta entry de outra Pagina', () => {
    const result = adapter.parseWebhook(
      {
        object: 'page',
        entry: [
          {
            id: 'PAGE_OUTRA',
            messaging: [
              {
                sender: { id: 'PSID_1' },
                recipient: { id: 'PAGE_OUTRA' },
                timestamp: 1,
                message: { mid: 'm_x', text: 'nao e minha' },
              },
            ],
          },
        ],
      },
      makeChannel({ pageId: 'PAGE_1' }),
    );

    expect(result.messages).toHaveLength(0);
  });

  it('extrai status de entrega e leitura', () => {
    const result = adapter.parseWebhook(
      {
        object: 'page',
        entry: [
          {
            id: 'PAGE_1',
            messaging: [
              { sender: { id: 'PSID_1' }, timestamp: 1, delivery: { mids: ['m_1'] } },
              { sender: { id: 'PSID_1' }, timestamp: 2, read: { watermark: 1458692752478 } },
            ],
          },
        ],
      },
      makeChannel({ pageId: 'PAGE_1' }),
    );

    expect(result.statuses).toHaveLength(2);
  });

  it('nao estoura com payload malformado', () => {
    const result = adapter.parseWebhook({ entry: 'isso nao e array' }, makeChannel({ pageId: 'PAGE_1' }));

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.messages).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/modules/channel-hub/adapters/messenger/messenger.inbound-adapter.spec.ts`
Expected: FAIL — `Cannot find module './messenger.inbound-adapter'`

- [ ] **Step 3: Implementar o adapter**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Channel, ChannelType } from '@prisma/client';
import { InboundChannelPort, ChannelLocator } from '../../ports/inbound-channel.port';
import { WebhookParseResult, VerificationResponse } from '../../ports/types';
import { MessengerMessageMapper } from './messenger.message-mapper';
import {
  verifyMetaSignature,
  handleMetaVerification,
} from '../meta-shared/meta-signature.util';

@Injectable()
export class MessengerInboundAdapter implements InboundChannelPort {
  readonly channelType = ChannelType.MESSENGER;
  private readonly logger = new Logger(MessengerInboundAdapter.name);

  constructor(private readonly mapper: MessengerMessageMapper) {}

  extractLocators(payload: unknown): ChannelLocator[] {
    const body = (payload ?? {}) as Record<string, any>;
    const entries: any[] = Array.isArray(body?.entry) ? body.entry : [];
    const seen = new Set<string>();
    const locators: ChannelLocator[] = [];

    for (const entry of entries) {
      const id = entry?.id ? String(entry.id) : undefined;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      locators.push({ pageId: id });
    }

    return locators;
  }

  matchesChannel(channel: Channel, locator: ChannelLocator): boolean {
    if (!locator.pageId) return false;
    const config = (channel.config ?? {}) as Record<string, any>;
    return config.pageId ? String(config.pageId) === locator.pageId : false;
  }

  validateWebhook(
    headers: Record<string, string>,
    rawBody: Buffer,
    _webhookSecret?: string,
    channel?: Channel,
  ): boolean {
    const appSecret = (channel?.config as Record<string, any> | undefined)?.appSecret;
    return verifyMetaSignature(headers, rawBody, appSecret);
  }

  parseWebhook(payload: unknown, channel?: Channel): WebhookParseResult {
    const result: WebhookParseResult = { messages: [], statuses: [], errors: [] };

    try {
      const body = (payload ?? {}) as Record<string, any>;
      const entries: any[] = Array.isArray(body?.entry) ? body.entry : [];
      if (body?.entry && !Array.isArray(body.entry)) {
        throw new Error('entry nao e um array');
      }

      const expectedPageId = (channel?.config as Record<string, any> | undefined)?.pageId;

      for (const entry of entries) {
        // Escopo estrito: descarta evento de outra Pagina.
        if (expectedPageId && entry?.id && String(entry.id) !== String(expectedPageId)) {
          continue;
        }

        const events: any[] = entry?.messaging ?? [];
        for (const event of events) {
          if (event.message) {
            const normalized = this.mapper.normalizeInbound(event);
            if (normalized) result.messages.push(normalized);
          }
          if (event.delivery) {
            const status = this.mapper.normalizeStatus(event);
            if (status) result.statuses.push(status);
          }
          if (event.read) {
            const status = this.mapper.normalizeReadStatus(event);
            if (status) result.statuses.push(status);
          }
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha ao processar webhook do Messenger: ${message}`);
      result.errors.push({ code: 'PARSE_ERROR', message, rawData: payload });
    }

    return result;
  }

  handleVerification(
    query: Record<string, string>,
    webhookSecret?: string,
  ): VerificationResponse {
    const result = handleMetaVerification(query, webhookSecret);
    if (result.statusCode === 200) {
      this.logger.log('Verificacao do webhook do Messenger bem-sucedida');
    } else {
      this.logger.warn('Verificacao do webhook do Messenger falhou');
    }
    return result;
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/modules/channel-hub/adapters/messenger/messenger.inbound-adapter.spec.ts`
Expected: PASS (7 testes)

- [ ] **Step 5: Commit**

```bash
git add src/modules/channel-hub/adapters/messenger/messenger.inbound-adapter.ts src/modules/channel-hub/adapters/messenger/messenger.inbound-adapter.spec.ts
git commit -m "feat(messenger): adapter de entrada com escopo por Page ID"
```

---

## Task 10: Adapter de saída

**Files:**
- Create: `src/modules/channel-hub/adapters/messenger/messenger.outbound-adapter.ts`

- [ ] **Step 1: Implementar**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Channel, ChannelType } from '@prisma/client';
import { OutboundChannelPort } from '../../ports/outbound-channel.port';
import {
  NormalizedOutboundMessage,
  SendResult,
  RateLimitConfig,
} from '../../ports/types';
import { MessengerMessageMapper } from './messenger.message-mapper';
import { MessengerHttpClient } from './messenger.http-client';

@Injectable()
export class MessengerOutboundAdapter implements OutboundChannelPort {
  readonly channelType = ChannelType.MESSENGER;
  private readonly logger = new Logger(MessengerOutboundAdapter.name);

  constructor(
    private readonly mapper: MessengerMessageMapper,
    private readonly httpClient: MessengerHttpClient,
  ) {}

  async sendMessage(
    channel: Channel,
    contactExternalId: string,
    message: NormalizedOutboundMessage,
  ): Promise<SendResult> {
    const payload = this.mapper.denormalize(message, contactExternalId);
    const response = await this.httpClient.sendMessage(channel, payload);

    return {
      externalId: response?.message_id || '',
      providerResponse: response,
    };
  }

  async sendTypingIndicator(channel: Channel, contactExternalId: string): Promise<void> {
    try {
      await this.httpClient.sendMessage(channel, {
        recipient: { id: contactExternalId },
        sender_action: 'typing_on',
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Indicador de digitacao do Messenger falhou: ${message}`);
    }
  }

  async getMediaUrl(_channel: Channel, mediaId: string): Promise<string> {
    return mediaId;
  }

  async downloadMedia(_channel: Channel, mediaUrl: string): Promise<Buffer> {
    return this.httpClient.downloadMedia(mediaUrl);
  }

  getRateLimits(): RateLimitConfig {
    return { maxPerSecond: 200, maxPerMinute: 5000, windowMs: 60000 };
  }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npm run typecheck`
Expected: sem erros. Se o `OutboundChannelPort` exigir `deleteMessage`, adicione:

```typescript
  async deleteMessage(_channel: Channel, externalMessageId: string): Promise<void> {
    throw new Error(
      `A Meta nao permite remover mensagens ja entregues no Messenger via API ` +
        `(id=${externalMessageId}). Marcamos como deletada apenas no Sendtur.`,
    );
  }
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/channel-hub/adapters/messenger/messenger.outbound-adapter.ts
git commit -m "feat(messenger): adapter de saida"
```

---

## Task 11: Enriquecimento de contato

**Files:**
- Create: `src/modules/channel-hub/adapters/messenger/messenger-contact-enricher.service.ts`

- [ ] **Step 1: Implementar**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Channel } from '@prisma/client';
import { PrismaService } from '../../../../database/prisma.service';
import { MessengerHttpClient } from './messenger.http-client';

@Injectable()
export class MessengerContactEnricherService {
  private readonly logger = new Logger(MessengerContactEnricherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpClient: MessengerHttpClient,
  ) {}

  /**
   * Busca nome e foto do PSID no Graph e preenche o contato.
   * Nunca lanca: enriquecimento e enfeite, e falha aqui nao pode derrubar a
   * entrega da mensagem.
   */
  async enrich(channel: Channel, externalContactId: string): Promise<void> {
    try {
      const profile = await this.httpClient.getUserProfile(channel, externalContactId);
      if (!profile) return;

      const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim();
      const avatarUrl = profile.profile_pic;
      if (!name && !avatarUrl) return;

      const contactChannel = await this.prisma.contactChannel.findUnique({
        where: {
          uq_contact_channel_external: {
            channelId: channel.id,
            externalId: externalContactId,
          },
        },
        include: { contact: true },
      });
      if (!contactChannel) return;

      const ccUpdates: Record<string, unknown> = {};
      if (name && name !== contactChannel.profileName) ccUpdates.profileName = name;
      if (avatarUrl && avatarUrl !== contactChannel.profileAvatarUrl) {
        ccUpdates.profileAvatarUrl = avatarUrl;
      }
      if (Object.keys(ccUpdates).length > 0) {
        await this.prisma.contactChannel.update({
          where: { id: contactChannel.id },
          data: ccUpdates,
        });
      }

      const contactUpdates: Record<string, unknown> = {};
      if (name && !contactChannel.contact.name) contactUpdates.name = name;
      if (avatarUrl && !contactChannel.contact.avatarUrl) contactUpdates.avatarUrl = avatarUrl;
      if (Object.keys(contactUpdates).length > 0) {
        await this.prisma.contact.update({
          where: { id: contactChannel.contactId },
          data: contactUpdates,
        });
      }

      this.logger.log(
        `Contato do Messenger enriquecido: ${externalContactId} → ${name || '(sem nome)'}`,
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Enriquecimento do contato ${externalContactId} falhou: ${message}`,
      );
    }
  }
}
```

- [ ] **Step 2: Verificar tipos**

Run: `npm run typecheck`
Expected: sem erros

- [ ] **Step 3: Commit**

```bash
git add src/modules/channel-hub/adapters/messenger/messenger-contact-enricher.service.ts
git commit -m "feat(messenger): enriquecimento de nome e foto do contato"
```

---

## Task 12: Módulo e registro no hub

**Files:**
- Create: `src/modules/channel-hub/adapters/messenger/messenger.module.ts`
- Modify: `src/modules/channel-hub/channel-hub.module.ts`

- [ ] **Step 1: Criar o módulo**

```typescript
import { Module } from '@nestjs/common';
import { MessengerInboundAdapter } from './messenger.inbound-adapter';
import { MessengerOutboundAdapter } from './messenger.outbound-adapter';
import { MessengerMessageMapper } from './messenger.message-mapper';
import { MessengerHttpClient } from './messenger.http-client';
import { MessengerContactEnricherService } from './messenger-contact-enricher.service';

@Module({
  providers: [
    MessengerInboundAdapter,
    MessengerOutboundAdapter,
    MessengerMessageMapper,
    MessengerHttpClient,
    MessengerContactEnricherService,
  ],
  exports: [
    MessengerInboundAdapter,
    MessengerOutboundAdapter,
    MessengerHttpClient,
    MessengerContactEnricherService,
  ],
})
export class MessengerModule {}
```

- [ ] **Step 2: Registrar no `channel-hub.module.ts`**

Adicione os imports junto aos do Instagram (por volta da linha 16):

```typescript
import { MessengerModule } from './adapters/messenger/messenger.module';
import { MessengerInboundAdapter } from './adapters/messenger/messenger.inbound-adapter';
import { MessengerOutboundAdapter } from './adapters/messenger/messenger.outbound-adapter';
```

Acrescente `MessengerModule` ao array `imports` (após `InstagramModule`) e ao
array `exports` (após `InstagramModule`).

No construtor da classe, acrescente após os campos do Instagram:

```typescript
    private readonly messengerInbound: MessengerInboundAdapter,
    private readonly messengerOutbound: MessengerOutboundAdapter,
```

E em `onModuleInit()`, após a linha do Instagram:

```typescript
    this.registry.register(this.messengerInbound, this.messengerOutbound);
```

> **Cuidado com ciclo de DI:** este projeto já derrubou produção com import
> circular. O `MessengerModule` não importa nada de `messaging` — se você sentir
> necessidade de importar, pare e reveja.

- [ ] **Step 3: Verificar tipos**

Run: `npm run typecheck`
Expected: sem erros

- [ ] **Step 4: Rodar a suíte inteira (o guarda de ciclo de DI mora nela)**

Run: `npm test`
Expected: PASS, incluindo o teste que detecta `UndefinedDependencyException`

- [ ] **Step 5: Commit**

```bash
git add src/modules/channel-hub/adapters/messenger/messenger.module.ts src/modules/channel-hub/channel-hub.module.ts
git commit -m "feat(messenger): registra o adapter no channel-hub"
```

---

## Task 13: Gate de janela aceita Messenger

**Files:**
- Modify: `src/modules/messaging/conversations/whatsapp-window.util.ts`
- Modify: `src/modules/messaging/pipeline/whatsapp-window-gate.service.ts` → renomear para `meta-window-gate.service.ts`
- Modify: `src/modules/messaging/pipeline/whatsapp-window-gate.service.spec.ts` → renomear para `meta-window-gate.service.spec.ts`

- [ ] **Step 1: Acrescentar os testes de Messenger ao spec do gate**

O arquivo `src/modules/messaging/pipeline/whatsapp-window-gate.service.spec.ts`
já tem um helper `make({ lastInboundAt, ctwaClidAt })` que monta os mocks de
Prisma e realtime, e os atalhos `now` / `hoursAgo(h)`. Reaproveite os dois.
Acrescente ao final do `describe('WhatsappWindowGate.blockIfClosed')`:

```typescript
  it('Messenger + texto livre + fora das 24h → bloqueia', async () => {
    const { gate, prisma, realtime } = make({ lastInboundAt: hoursAgo(30), ctwaClidAt: null });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'MESSENGER',
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

  it('Messenger + texto livre + dentro das 24h → libera', async () => {
    const { gate, prisma } = make({ lastInboundAt: hoursAgo(2), ctwaClidAt: null });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'MESSENGER',
      messageType: MessageContentType.TEXT,
      now,
    });
    expect(blocked).toBe(false);
    expect(prisma.message.update).not.toHaveBeenCalled();
  });

  // A extensao de 72h e exclusiva do Click-to-WhatsApp. Se ela vazasse pro
  // Messenger, mandariamos mensagem que a Meta vai recusar — e o atendente
  // veria "enviada" numa mensagem que nunca chegou.
  it('Messenger nao herda a extensao de 72h do CTWA', async () => {
    const { gate } = make({ lastInboundAt: hoursAgo(30), ctwaClidAt: hoursAgo(30) });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'MESSENGER',
      messageType: MessageContentType.TEXT,
      now,
    });
    expect(blocked).toBe(true);
  });

  // Guarda de regressao: o mesmo cenario NO WHATSAPP continua liberado pelas
  // 72h do CTWA. Sem este teste, restringir a extensao poderia quebrar o
  // WhatsApp em silencio.
  it('WhatsApp continua liberado pelas 72h do CTWA', async () => {
    const { gate } = make({ lastInboundAt: hoursAgo(30), ctwaClidAt: hoursAgo(30) });
    const blocked = await gate.blockIfClosed({
      messageId: 'msg1',
      channelType: 'WHATSAPP_OFFICIAL',
      messageType: MessageContentType.TEXT,
      now,
    });
    expect(blocked).toBe(false);
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/modules/messaging/pipeline/whatsapp-window-gate.service.spec.ts`
Expected: FAIL nos três testes novos — o gate hoje devolve `false` para qualquer
canal que não seja `WHATSAPP_OFFICIAL`

- [ ] **Step 3: Restringir a extensão do CTWA ao WhatsApp**

Em `whatsapp-window.util.ts`, dentro de `computeWhatsappWindow`, troque o cálculo
do `ctwa` para só valer no canal oficial do WhatsApp:

```typescript
  // A extensao de 72h do Click-to-WhatsApp so existe no WhatsApp. No Messenger
  // a janela e sempre 24h a partir da ultima mensagem de entrada.
  const isWhatsapp = input.channelType === 'WHATSAPP_OFFICIAL';
  const ctwa =
    isWhatsapp && input.ctwaClidAt
      ? input.ctwaClidAt.getTime() + CTWA_WINDOW_MS
      : 0;
```

Aplique a mesma condição ao `metaWindowExpiresAt`, que também é um conceito do
WhatsApp.

- [ ] **Step 4: Fazer o gate aceitar Messenger**

Em `whatsapp-window-gate.service.ts`, troque a linha do guarda:

```typescript
    // Regra so existe no canal oficial da Meta.
    if (params.channelType !== 'WHATSAPP_OFFICIAL') return false;
```

por:

```typescript
    // Vale nos canais da Meta que tem janela de atendimento: WhatsApp oficial
    // (24h/72h) e Messenger (24h fixas).
    const GATED_CHANNELS = ['WHATSAPP_OFFICIAL', 'MESSENGER'];
    if (!GATED_CHANNELS.includes(params.channelType)) return false;
```

E ajuste a mensagem de bloqueio para não mentir no Messenger, onde não existe
template:

```typescript
const BLOCK_REASON_WHATSAPP =
  'Janela de atendimento (24h/72h) fechada — envie um template aprovado.';
const BLOCK_REASON_MESSENGER =
  'Janela de atendimento do Messenger (24h) fechada — a Meta nao permite ' +
  'enviar fora dela. Aguarde o cliente responder.';
```

Use a constante correta conforme `params.channelType` ao gravar o `failedReason`.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm test -- src/modules/messaging/pipeline/whatsapp-window-gate.service.spec.ts`
Expected: PASS (os testes antigos de WhatsApp + os três novos)

- [ ] **Step 6: Renomear serviço e arquivos**

```bash
git mv src/modules/messaging/pipeline/whatsapp-window-gate.service.ts src/modules/messaging/pipeline/meta-window-gate.service.ts
git mv src/modules/messaging/pipeline/whatsapp-window-gate.service.spec.ts src/modules/messaging/pipeline/meta-window-gate.service.spec.ts
```

Renomeie a classe `WhatsappWindowGate` para `MetaWindowGate` nos dois arquivos e
em todos os pontos que a injetam. Para achá-los:

Run: `grep -rn "WhatsappWindowGate" src/`
Expected: depois do rename completo, nenhum resultado.

> O helper `computeWhatsappWindow` e o arquivo `whatsapp-window.util.ts`
> **mantêm o nome** — a lógica deles continua sendo majoritariamente regra de
> WhatsApp (24h/72h CTWA).

- [ ] **Step 7: Rodar tudo**

Run: `npm test && npm run typecheck`
Expected: PASS, sem erros de tipo

- [ ] **Step 8: Commit**

```bash
git add -u src/modules/messaging/
git commit -m "feat(messaging): gate de janela vale para Messenger (24h, sem CTWA)"
```

---

## Task 14: Enriquecimento no pipeline de entrada

**Files:**
- Modify: `src/modules/messaging/pipeline/inbound-message.processor.ts`

- [ ] **Step 1: Acrescentar o bloco do Messenger**

Logo após o bloco `if (message.channelType === ChannelType.INSTAGRAM) { ... }`
(por volta da linha 158), acrescente o equivalente:

```typescript
      if (message.channelType === ChannelType.MESSENGER) {
        const [channel, contact] = await Promise.all([
          this.prisma.channel.findUnique({ where: { id: channelId } }),
          isNewContact
            ? Promise.resolve(null)
            : this.prisma.contact.findUnique({
                where: { id: contactId },
                select: { name: true, avatarUrl: true },
              }),
        ]);
        const needsEnrichment = isNewContact || !contact?.name || !contact?.avatarUrl;
        if (channel && needsEnrichment) {
          // Fire-and-forget: enriquecimento nunca pode bloquear a entrega.
          this.messengerEnricher
            .enrich(channel, message.externalContactId)
            .catch((err) =>
              this.logger.warn(`Enriquecimento do Messenger falhou: ${err.message}`),
            );
        }
      }
```

Injete o serviço no construtor, ao lado do `instagramEnricher`:

```typescript
    private readonly messengerEnricher: MessengerContactEnricherService,
```

E importe:

```typescript
import { MessengerContactEnricherService } from '../../channel-hub/adapters/messenger/messenger-contact-enricher.service';
```

> **Atenção:** este projeto já derrubou produção porque um parâmetro de
> construtor não resolvia. Garanta que o módulo que declara este processor
> importa o `MessengerModule` (ou o `ChannelHubModule`, que o exporta) —
> senão o boot quebra em crashloop e os testes unitários não pegam.

- [ ] **Step 2: Rodar a suíte inteira**

Run: `npm test`
Expected: PASS, incluindo o guarda de ciclo de DI

- [ ] **Step 3: Verificar tipos**

Run: `npm run typecheck`
Expected: sem erros

- [ ] **Step 4: Commit**

```bash
git add src/modules/messaging/pipeline/inbound-message.processor.ts
git commit -m "feat(messenger): enriquece contato no pipeline de entrada"
```

---

## Task 15: Confirmar que a criação do canal está liberada

**Files:**
- Verify: `src/modules/channel-hub/channels/channels.service.ts:54`

- [ ] **Step 1: Ler o guarda**

Run: `grep -n "WHATSAPP_WASENDER" src/modules/channel-hub/channels/channels.service.ts`
Expected: a linha 54, `if (dto.type === ChannelType.WHATSAPP_WASENDER) {`

Esse guarda é uma lista de **bloqueio** com um único item — barra apenas o
Wasender. `MESSENGER` não está nela, portanto a criação já é permitida e
**não há código a mudar nesta task.**

Se, ao ler o arquivo, você encontrar uma allowlist em vez disso (o código pode
ter mudado desde que este plano foi escrito), acrescente
`ChannelType.MESSENGER` a ela e commite.

- [ ] **Step 2: Provar que funciona de ponta a ponta**

Suba a API local (`npm run start:dev`) e crie o canal via API, substituindo os
valores entre `<>`:

```bash
curl -X POST http://localhost:3000/api/v1/channels \
  -H "Authorization: Bearer <SEU_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "MESSENGER",
    "name": "Messenger — Página de teste",
    "config": {
      "pageId": "<PAGE_ID>",
      "accessToken": "<PAGE_ACCESS_TOKEN>",
      "appSecret": "<APP_SECRET>",
      "apiVersion": "v21.0"
    },
    "webhookSecret": "<VERIFY_TOKEN>"
  }'
```

Expected: HTTP 201 com o canal criado. Se vier 400 com mensagem de tipo não
suportado, o guarda é uma allowlist — volte ao Step 1.

---

## Task 16: Provar a re-hospedagem de mídia

A re-hospedagem é feita pelo `MediaResolverService`, que é agnóstico de canal:
ele chama `adapter.downloadMedia(channel, url)` pelo registry. O Messenger
herda esse caminho pelo método implementado na Task 10 — esta task existe para
**provar** isso, não para escrever código novo.

**Files:**
- Verify: `src/modules/messaging/messages/media-resolver.service.ts:131-138`

- [ ] **Step 1: Confirmar que o resolver não tem caso especial por canal**

Run: `grep -n "ChannelType\." src/modules/messaging/messages/media-resolver.service.ts`
Expected: nenhum resultado, ou nenhum que ramifique o download por tipo de
canal. Se houver um `switch` por canal, o Messenger precisa entrar nele — pare
e acrescente antes de seguir.

- [ ] **Step 2: Confirmar que o adapter expõe o método**

Run: `grep -n "downloadMedia" src/modules/channel-hub/adapters/messenger/messenger.outbound-adapter.ts`
Expected: a assinatura `async downloadMedia(_channel: Channel, mediaUrl: string): Promise<Buffer>`

- [ ] **Step 3: Teste manual (depois do deploy)**

Envie uma foto da sua conta pessoal para a Página. Abra a conversa no inbox e
confirme que a imagem carrega **e** que a URL exibida é do domínio de vocês, não
de `scontent.xx.fbcdn.net`.

> Falha aqui não quebra a mensagem: o resolver cai de volta na URL da Meta sem
> cachear. O sintoma é a imagem parar de abrir dias depois, quando o link da
> Meta expira.

---

## Task 17: Configuração na Meta (manual, feita no painel)

Sem estes passos o código não recebe nada. Não é trabalho de programação, mas é
pré-requisito para o canal funcionar — por isso está no plano.

- [ ] **Step 1: Adicionar o produto Messenger ao app** em developers.facebook.com

- [ ] **Step 2: Gerar o Page Access Token** da Página, com as permissões
`pages_messaging` e `pages_manage_metadata`

- [ ] **Step 3: Apontar o webhook** para
`https://api-ofpchat.explotek.pro/api/v1/webhooks/MESSENGER`, usando como Verify
Token o mesmo valor gravado no campo "Webhook Secret" do canal

> O domínio `api-ofpchat.com.br` **não existe** — já causou "não entra mensagem"
> neste projeto antes.

- [ ] **Step 4: Assinar a Página nos campos `messages` E `messaging_referrals`**

Assinar só `messages` faz o canal funcionar mas perde a atribuição de anúncio
das threads que já existiam. O Plano 2 depende deste passo.

- [ ] **Step 5: Classificar o bot como "hybrid"** em Configurações da Página →
Mensagens avançadas

A classificação "automated" carrega a exigência de responder qualquer entrada em
30 segundos. A Aline é híbrida (IA + transferência para humano), então "hybrid"
é a classificação correta — e evita restrição por política de responsividade.

- [ ] **Step 6: Testar o handshake**

Ao salvar o webhook no painel, a Meta faz um GET de verificação. Se aparecer
erro de verificação, confira se o Verify Token do painel é idêntico ao
"Webhook Secret" do canal.

---

## Task 18: Verificação de ponta a ponta

- [ ] **Step 1: Suíte completa**

Run: `npm test`
Expected: PASS, zero falhas

- [ ] **Step 2: Tipos**

Run: `npm run typecheck`
Expected: sem erros

- [ ] **Step 3: Build (prova que o app sobe)**

Run: `npm run build`
Expected: `nest build` sem erros

> Este projeto teve três quedas em três dias por falhas que só aparecem no boot.
> Build limpo não é garantia de boot limpo — a validação real acontece no deploy,
> com a sentinela do `deploy-safe.sh`.

- [ ] **Step 4: Conferir que o adapter foi registrado**

Run: `grep -n "messengerInbound" src/modules/channel-hub/channel-hub.module.ts`
Expected: uma linha no construtor e uma em `onModuleInit`

- [ ] **Step 5: Commit final e push**

```bash
git push -u fork feat/messenger-channel
```

Abra PR contra `feat/conversation-tabs` (a branch viva). **Não empurre direto na
branch viva.**

---

## O que fica para os próximos planos

**Plano 2 — Atribuição de anúncio:** captura do `referral` nos dois formatos
(thread nova via `message.referral`, thread existente via evento solto), mudança
no `tagAdLeadIfReferral` para aceitar `sourceType === 'ad'` além do `ctwaClid`,
e o selo "Anúncio" no card.

**Plano 3 — Histórico:** `messenger.sync-adapter.ts` com
`/me/conversations?platform=messenger`, registro em `registerHistorySync` e o
cron de sincronização.

**Frontend:** ícone do Messenger e o tipo nos oito arquivos que fazem `switch`
por canal, no repositório `chat-bullq-web`. Sem isso o canal existe na API mas
não aparece na tela de criação — dá para criar por chamada direta à API enquanto
o front não sai.
