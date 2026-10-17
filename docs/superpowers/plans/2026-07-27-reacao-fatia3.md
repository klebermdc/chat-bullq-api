# Fatia 3 — Reagir a uma mensagem com emoji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O atendente passa o mouse numa bolha, escolhe 👍 e a reação chega no WhatsApp do cliente como reação — não como mensagem.

**Architecture:** Reação **não** passa pelo `MessagesService.send()`. Ganha um método próprio, `react()`, porque o `send()` carrega um conjunto grande de efeitos de "um humano respondeu" que não valem para um polegar. O método resolve o id externo da mensagem alvo, grava `content.reaction.targetMessageId` (que é o que o mapper da Meta lê) e enfileira no mesmo caminho de saída.

**Tech Stack:** NestJS · Prisma 6 · BullMQ · Jest (API) · Next 16 · React (web)

**Repositórios:** `chat-bullq-api` (branch `feat/reaction-send-api`) e `chat-bullq-web` (branch `feat/reaction-send-web`), a partir de `fork/feat/conversation-tabs`.

---

## O achado que define esta fatia

`MessagesService.send()` faz muito mais do que enviar. Ao final dele, a conversa:

- **muda de dono** — `shouldAutoAssign` reatribui a conversa a quem enviou
  (`messages.service.ts:225-231`);
- **desliga a IA** — `aiEnabled: false`, `activeAgentId: null`
  (`messages.service.ts:251-258`);
- **sai de "Esperando"** — `awaitingHumanReply: false`;
- **perde o reengajamento** — `inactivityBand: null`, `reengageDismissedAt: null`;
- **cancela o watchdog** — `watchdog.cancelCheck()`;
- **marca como lida** em nome do remetente;
- **sobe na lista** — `lastMessageAt` é atualizado.

Tudo isso está certo para uma resposta de verdade e **errado para uma reação**.
Um 👍 num card de colega roubaria a conversa dele, desligaria a Aline e tiraria o
lead da cadência de reengajamento — três bugs de produto num clique.

Existe o flag `automated: true`, que pula quase tudo, mas ele significa "mensagem
de sistema" e reação é ação humana deliberada. Usá-lo seria uma mentira semântica
que o próximo leitor paga. Por isso: **método próprio**.

## Contexto que o implementador precisa saber

- **O mapper oficial já está pronto** e lê
  `message.content.reaction.targetMessageId` + `.emoji`
  (`whatsapp-official.message-mapper.ts:190-202`). Ele **não** usa `replyTo` —
  a Cloud API rejeita `context` em reação, e o mapper já remove.
- Portanto a UI manda o **id interno** da mensagem alvo e a API resolve para o
  **id externo** antes de gravar o `content`. Mesma resolução que o "Responder"
  já faz (`messages.service.ts:134-157`).
- **O Wasender/Baileys não envia reação** — não existe endpoint na API deles.
  Hoje `REACTION` cairia no `default` do `denormalize()` e sairia como **mensagem
  de texto solta** com o emoji. É um bug latente que só não aparece porque o DTO
  bloqueia antes. A Task 2 fecha isso.
- **A reação recebida já renderiza** — `chat-panel.tsx:970` lê
  `msg.content.reaction.emoji`. A UI de saída deve produzir o mesmo formato.
- **O gate de janela já cobre** — `WhatsappWindowGate` só libera `TEMPLATE` fora
  da janela, então reação fora das 24h vira `FAILED` sozinha.
- **Fora de escopo:** remover ou trocar uma reação já enviada.

## Estrutura de arquivos

### API

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/messaging/messages/dto/react-message.dto.ts` *(criar)* | DTO do endpoint de reação. |
| `src/modules/messaging/messages/reaction.util.ts` *(criar)* | Validação do emoji (grafema único). Pura. |
| `src/modules/messaging/messages/reaction.util.spec.ts` *(criar)* | Testes da validação. |
| `src/modules/messaging/messages/messages.service.ts` *(modificar)* | Método `react()`. |
| `src/modules/messaging/messages/messages.service.reaction.spec.ts` *(criar)* | Testes do `react()` — inclusive o que ele NÃO faz. |
| `src/modules/messaging/messages/messages.controller.ts` *(modificar)* | `POST /messages/:id/react`. |
| `src/modules/channel-hub/adapters/wasender/wasender.message-mapper.ts` *(modificar)* | `default` deixa de virar texto. |
| `src/modules/channel-hub/adapters/wasender/wasender.message-mapper.spec.ts` *(modificar)* | Teste de regressão. |

### Web

| Arquivo | Responsabilidade |
|---|---|
| `src/features/inbox/components/message-reaction-bar.tsx` *(criar)* | Barra de 6 emojis no hover. |
| `src/features/inbox/services/inbox.service.ts` *(modificar)* | `reactToMessage()`. |
| `src/features/inbox/components/chat-panel.tsx` *(modificar)* | Monta a barra na bolha. |

---

# PARTE A — API

## Task 1: Validação do emoji (TDD)

**Files:**
- Create: `src/modules/messaging/messages/reaction.util.ts`
- Test: `src/modules/messaging/messages/reaction.util.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { isSingleEmoji } from './reaction.util';

describe('isSingleEmoji', () => {
  it('aceita emoji simples', () => {
    expect(isSingleEmoji('👍')).toBe(true);
  });

  it('aceita emoji composto por ZWJ (família, profissões)', () => {
    expect(isSingleEmoji('👩‍💻')).toBe(true);
  });

  it('aceita emoji com modificador de tom de pele', () => {
    expect(isSingleEmoji('👍🏽')).toBe(true);
  });

  it('recusa dois emojis', () => {
    expect(isSingleEmoji('👍👎')).toBe(false);
  });

  it('recusa texto', () => {
    expect(isSingleEmoji('oi')).toBe(false);
  });

  it('recusa string vazia', () => {
    expect(isSingleEmoji('')).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `yarn test reaction.util`
Expected: FAIL — `Cannot find module './reaction.util'`.

- [ ] **Step 3: Implementar**

```ts
/**
 * Reação tem que ser exatamente UM emoji.
 *
 * `.length` não serve: "👍" tem length 2 (par surrogate) e "👩‍💻" tem 5. O
 * `Intl.Segmenter` com granularity 'grapheme' conta o que o usuário enxerga
 * como um caractere só, que é a unidade certa aqui.
 */
export function isSingleEmoji(value: string): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;

  const segmenter = new Intl.Segmenter('pt', { granularity: 'grapheme' });
  const graphemes = Array.from(segmenter.segment(value));
  if (graphemes.length !== 1) return false;

  return /\p{Extended_Pictographic}/u.test(value);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `yarn test reaction.util`
Expected: PASS — 6 testes.

- [ ] **Step 5: Commit**

```bash
git add src/modules/messaging/messages/reaction.util.ts src/modules/messaging/messages/reaction.util.spec.ts
git commit -m "feat(messages): validacao de emoji unico para reacao"
```

---

## Task 2: Wasender para de mandar reação como texto (TDD)

**Files:**
- Modify: `src/modules/channel-hub/adapters/wasender/wasender.message-mapper.ts`
- Test: `src/modules/channel-hub/adapters/wasender/wasender.message-mapper.spec.ts`

- [ ] **Step 1: Escrever o teste de regressão**

Acrescentar ao `wasender.message-mapper.spec.ts`:

```ts
  it('NAO transforma REACTION em mensagem de texto', () => {
    expect(() =>
      mapper.denormalize(
        {
          type: MessageContentType.REACTION,
          content: { reaction: { emoji: '👍', targetMessageId: 'ext-1' } },
        } as any,
        '5511999999999@s.whatsapp.net',
      ),
    ).toThrow(/não suporta/i);
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `yarn test wasender.message-mapper`
Expected: FAIL — não lança; devolve `{ to, text: '' }`.

- [ ] **Step 3: Trocar o `default` do `denormalize()`**

Em `wasender.message-mapper.ts`, substituir

```ts
      default:
        return { endpoint, payload: { to, text: message.content.text ?? '' } };
```

por

```ts
      // Tipos que este canal não sabe enviar precisam FALHAR alto. O default
      // antigo devolvia `{ text }`, então uma reação sairia como uma mensagem
      // de texto solta com o emoji — o cliente veria "👍" numa bolha, não uma
      // reação. Falhar aqui vira FAILED na UI, que é honesto.
      default:
        throw new Error(
          `Canal Wasender não suporta enviar mensagem do tipo ${message.type}`,
        );
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `yarn test wasender.message-mapper`
Expected: PASS — inclusive os testes que já existiam.

- [ ] **Step 5: Commit**

```bash
git add src/modules/channel-hub/adapters/wasender
git commit -m "fix(wasender): tipo nao suportado falha em vez de virar texto"
```

---

## Task 3: Método `react()` (TDD)

**Files:**
- Create: `src/modules/messaging/messages/dto/react-message.dto.ts`
- Modify: `src/modules/messaging/messages/messages.service.ts`
- Test: `src/modules/messaging/messages/messages.service.reaction.spec.ts`

- [ ] **Step 1: Criar o DTO**

```ts
import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ReactMessageDto {
  @ApiProperty({ example: '👍', description: 'Exatamente um emoji' })
  @IsString()
  emoji: string;
}
```

- [ ] **Step 2: Escrever os testes**

Criar `src/modules/messaging/messages/messages.service.reaction.spec.ts`. O
terceiro teste é o que mais importa: ele trava o achado que originou esta fatia.

O padrão de mock é o mesmo de `messages.access.spec.ts`, que já existe no repo —
instancia o service por `Object.create(MessagesService.prototype)` e injeta as
dependências com `Object.assign`, sem subir módulo do Nest.

```ts
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { MessagesService } from './messages.service';

const conversation = {
  id: 'conv1',
  organizationId: 'org1',
  channelId: 'chan1',
  assignedToId: 'colega-u2',
  contactId: 'contact1',
  channel: { id: 'chan1', type: 'WHATSAPP_OFFICIAL' },
  contact: {
    channels: [{ channelId: 'chan1', externalId: '5511999999999@s.whatsapp.net' }],
  },
};

function makeService(target: unknown) {
  const prisma: any = {
    message: { findFirst: jest.fn().mockResolvedValue(target) },
    conversation: { update: jest.fn() },
    conversationRead: { upsert: jest.fn() },
  };
  const repository = {
    create: jest.fn().mockImplementation((data: any) =>
      Promise.resolve({ id: 'msg-nova', ...data }),
    ),
  };
  const outboundQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const realtimeGateway = {
    emitToConversation: jest.fn(),
    emitToUser: jest.fn(),
    emitToChannel: jest.fn(),
  };
  const conversationAccess = { assertConversationAccess: jest.fn() };
  const channelAccess = { assertChannelAccess: jest.fn() };
  const watchdog = { cancelCheck: jest.fn().mockResolvedValue(undefined) };

  const svc: MessagesService = Object.create(MessagesService.prototype);
  Object.assign(svc, {
    prisma,
    repository,
    outboundQueue,
    realtimeGateway,
    conversationAccess,
    channelAccess,
    watchdog,
  });
  return { svc, prisma, repository, outboundQueue, watchdog };
}

describe('MessagesService.react', () => {
  it('grava targetMessageId com o id EXTERNO da mensagem alvo', async () => {
    const { svc, repository, outboundQueue } = makeService({
      id: 'msg-alvo',
      externalId: 'wamid.ABC',
      conversation,
    });

    await svc.react('msg-alvo', '👍', 'user-1', 'org1', 'ALL', OrgRole.AGENT);

    // É 'wamid.ABC' e não 'msg-alvo': o mapper da Cloud API lê o id externo.
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'REACTION',
        content: { reaction: { emoji: '👍', targetMessageId: 'wamid.ABC' } },
      }),
    );
    expect(outboundQueue.add).toHaveBeenCalledWith(
      'send-outbound',
      expect.objectContaining({
        message: {
          type: 'REACTION',
          content: { reaction: { emoji: '👍', targetMessageId: 'wamid.ABC' } },
        },
      }),
      expect.anything(),
    );
  });

  it('recusa emoji que não é um único grafema', async () => {
    const { svc } = makeService({
      id: 'msg-alvo',
      externalId: 'wamid.ABC',
      conversation,
    });

    await expect(
      svc.react('msg-alvo', 'oi', 'user-1', 'org1', 'ALL', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      svc.react('msg-alvo', '👍👎', 'user-1', 'org1', 'ALL', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('NÃO reatribui a conversa, NÃO desliga a IA e NÃO cancela o watchdog', async () => {
    // Este teste é o motivo de react() existir separado de send(). Se alguém
    // "simplificar" react() para chamar send(), ele quebra — que é o objetivo.
    const { svc, prisma, watchdog } = makeService({
      id: 'msg-alvo',
      externalId: 'wamid.ABC',
      conversation,
    });

    await svc.react('msg-alvo', '👍', 'user-1', 'org1', 'ALL', OrgRole.AGENT);

    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(prisma.conversationRead.upsert).not.toHaveBeenCalled();
    expect(watchdog.cancelCheck).not.toHaveBeenCalled();
  });

  it('recusa reagir a mensagem ainda não sincronizada com o provider', async () => {
    const { svc } = makeService({
      id: 'msg-alvo',
      externalId: null,
      conversation,
    });

    await expect(
      svc.react('msg-alvo', '👍', 'user-1', 'org1', 'ALL', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa mensagem inexistente', async () => {
    const { svc } = makeService(null);

    await expect(
      svc.react('nao-existe', '👍', 'user-1', 'org1', 'ALL', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recusa mensagem de outra organização', async () => {
    const { svc } = makeService({
      id: 'msg-alvo',
      externalId: 'wamid.ABC',
      conversation: { ...conversation, organizationId: 'org-OUTRA' },
    });

    await expect(
      svc.react('msg-alvo', '👍', 'user-1', 'org1', 'ALL', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `yarn test messages.service.reaction`
Expected: FAIL — `svc.react is not a function`.

- [ ] **Step 4: Implementar o `react()`**

Em `messages.service.ts`, acrescentar (importando `isSingleEmoji` de
`./reaction.util`):

```ts
  /**
   * Reage a uma mensagem com um emoji.
   *
   * DE PROPÓSITO não passa pelo `send()`. Aquele método aplica o pacote de
   * efeitos de "um humano respondeu": reatribui a conversa a quem enviou,
   * desliga a IA, tira de "Esperando", zera a faixa de inatividade, cancela o
   * watchdog e marca como lida. Nada disso deve acontecer porque alguém clicou
   * num polegar — reagir no card de um colega roubaria a conversa dele e
   * desligaria a Aline.
   *
   * Também não existe o flag `automated` aqui: reação é ação humana deliberada,
   * e marcá-la como automática seria mentir para quem ler depois.
   */
  async react(
    targetMessageId: string,
    emoji: string,
    senderId: string,
    organizationId: string,
    access: ChannelAccess = 'ALL',
    role?: OrgRole,
  ) {
    if (!isSingleEmoji(emoji)) {
      throw new BadRequestException('Reação precisa ser exatamente um emoji');
    }

    const target = await this.prisma.message.findFirst({
      where: { id: targetMessageId },
      select: {
        id: true,
        externalId: true,
        conversation: {
          include: { channel: true, contact: { include: { channels: true } } },
        },
      },
    });

    const conversation = target?.conversation;
    if (!target || !conversation) {
      throw new NotFoundException('Message not found');
    }
    if (conversation.organizationId !== organizationId) {
      throw new ForbiddenException();
    }
    await this.conversationAccess.assertConversationAccess(
      conversation.id,
      organizationId,
      role,
      senderId,
    );
    this.channelAccess.assertChannelAccess(access, conversation.channelId);

    if (!target.externalId) {
      throw new ForbiddenException(
        'Mensagem ainda não foi sincronizada com o provider — tente novamente em alguns segundos.',
      );
    }

    const contactChannel = conversation.contact.channels.find(
      (cc) => cc.channelId === conversation.channelId,
    );
    if (!contactChannel) {
      throw new NotFoundException('Contact channel not found');
    }

    // targetMessageId aqui é o id EXTERNO — é o campo que o mapper da Cloud
    // API lê (whatsapp-official.message-mapper.ts, case REACTION).
    const content = {
      reaction: { emoji, targetMessageId: target.externalId },
    };

    const message = await this.repository.create({
      conversationId: conversation.id,
      direction: MessageDirection.OUTBOUND,
      type: MessageContentType.REACTION,
      content,
      status: MessageStatus.QUEUED,
      senderId,
      metadata: { reactionTo: target.id },
    });

    this.realtimeGateway.emitToConversation(conversation.id, 'message:new', {
      message,
    });

    await this.outboundQueue.add(
      'send-outbound',
      {
        messageId: message.id,
        channelId: conversation.channelId,
        contactExternalId: contactChannel.externalId,
        message: { type: MessageContentType.REACTION, content },
      },
      {
        attempts: 6,
        backoff: { type: 'fixed', delay: 6_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );

    return message;
  }
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `yarn test messages.service.reaction`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/messaging/messages
git commit -m "feat(messages): metodo react() sem os efeitos de resposta humana"
```

---

## Task 4: Endpoint

**Files:**
- Modify: `src/modules/messaging/messages/messages.controller.ts`

- [ ] **Step 1: Adicionar a rota**

Seguindo o padrão dos outros endpoints do controller (mesmos guards e
decorators de `@CurrentOrg`/`@CurrentUser`/`@CurrentUserRole`):

```ts
  @Post(':id/react')
  @ApiOperation({ summary: 'React to a message with an emoji' })
  react(
    @Param('id') id: string,
    @Body() dto: ReactMessageDto,
    @CurrentUser('id') userId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.react(id, dto.emoji, userId, orgId, access, role);
  }
```

> Copiar a lista exata de decorators do método de envio que já existe neste
> controller — se `access`/`role` não forem passados, a checagem de escopo
> silenciosamente escopa ao próprio remetente.

- [ ] **Step 2: Suíte completa**

Run: `yarn test && yarn typecheck`
Expected: tudo verde.

- [ ] **Step 3: Commit**

```bash
git add src/modules/messaging/messages/messages.controller.ts
git commit -m "feat(messages): POST /messages/:id/react"
```

---

# PARTE B — Web

## Task 5: Cliente e barra de reação

**Files:**
- Modify: `src/features/inbox/services/inbox.service.ts`
- Create: `src/features/inbox/components/message-reaction-bar.tsx`

- [ ] **Step 1: Método no serviço**

Em `inbox.service.ts`, junto de `sendMessage`:

```ts
  async reactToMessage(messageId: string, emoji: string): Promise<Message> {
    const { data } = await api.post(`/messages/${messageId}/react`, { emoji });
    return data.data;
  },
```

- [ ] **Step 2: Criar a barra**

```tsx
'use client';

import { toast } from 'sonner';
import { inboxService } from '../services/inbox.service';

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

interface Props {
  messageId: string;
}

/**
 * Aparece no hover da bolha. Só os 6 rápidos — o picker completo não entra
 * aqui para não competir com o painel do compositor.
 */
export function MessageReactionBar({ messageId }: Props) {
  async function react(emoji: string) {
    try {
      await inboxService.reactToMessage(messageId, emoji);
    } catch {
      toast.error('Não foi possível reagir a esta mensagem.');
    }
  }

  return (
    <div className="flex items-center gap-0.5 rounded-full border border-zinc-200 bg-white px-1 py-0.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-800">
      {QUICK.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => react(emoji)}
          className="rounded-full px-1 text-base leading-none transition-transform hover:scale-125"
          aria-label={`Reagir com ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/features/inbox/services/inbox.service.ts src/features/inbox/components/message-reaction-bar.tsx
git commit -m "feat(inbox): barra de reacao rapida"
```

---

## Task 6: Montar na bolha

**Files:**
- Modify: `src/features/inbox/components/chat-panel.tsx`

- [ ] **Step 1: Renderizar no hover**

No wrapper da bolha em `chat-panel.tsx`, acrescentar `group` à classe do
container e a barra como filho revelado no hover:

```tsx
<div className="group relative">
  {/* ...bolha existente... */}
  <div className="pointer-events-none absolute -top-4 right-2 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
    <MessageReactionBar messageId={msg.id} />
  </div>
</div>
```

Importar `MessageReactionBar` no topo do arquivo.

- [ ] **Step 2: Não oferecer reação onde não faz sentido**

Envolver a barra numa condição que a esconde para mensagens que ainda não têm
`externalId` (a API recusaria) e para os tipos `REACTION` e `SYSTEM` — reagir a
uma reação não existe no WhatsApp:

```tsx
{msg.externalId && msg.type !== 'REACTION' && msg.type !== 'SYSTEM' && (
  /* ...barra... */
)}
```

- [ ] **Step 3: Verificar**

Run: `yarn test && npx tsc --noEmit && yarn build`
Expected: tudo verde.

- [ ] **Step 4: Commit**

```bash
git add src/features/inbox/components/chat-panel.tsx
git commit -m "feat(inbox): barra de reacao na bolha"
```

---

## Task 7: Verificação ponta a ponta

Precisa de uma conversa **em canal Meta oficial** com a janela de 24h aberta.

- [ ] **Step 1:** Passar o mouse numa bolha → a barra aparece.
- [ ] **Step 2:** Clicar em 👍 → o cliente vê uma **reação** na mensagem, não uma
      mensagem nova com o emoji.
- [ ] **Step 3 (o mais importante):** reagir numa conversa **atribuída a outro
      atendente** → a conversa **continua com ele**, a IA **continua ligada** e a
      conversa **não sai** de "Esperando". Se qualquer um desses três mudar, o
      `react()` está caindo no caminho do `send()`.
- [ ] **Step 4:** Reagir numa conversa de canal Wasender → aparece o toast de
      erro e a mensagem fica `FAILED`; o cliente **não** recebe um "👍" solto.
- [ ] **Step 5:** A barra não aparece em mensagem do tipo `REACTION` nem `SYSTEM`.

---

## Task 8: PRs

- [ ] **Step 1: PR da API**

```bash
git push -u origin feat/reaction-send-api
gh pr create --base feat/conversation-tabs \
  --title "feat(messages): reagir a mensagem com emoji" \
  --body "Fatia 3 da spec docs/superpowers/specs/2026-07-27-emoji-sticker-reacao-design.md

react() é um método próprio, NÃO passa pelo send(): aquele caminho reatribui a
conversa, desliga a IA, tira de Esperando e cancela o watchdog — efeitos que não
devem valer para um polegar.

Também corrige um bug latente: o default do mapper do Wasender transformaria uma
reação em mensagem de texto solta.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: PR da Web** (depois da API no ar)

```bash
git push -u origin feat/reaction-send-web
gh pr create --base feat/conversation-tabs \
  --title "feat(inbox): reagir a mensagem com emoji" \
  --body "Fatia 3 da spec docs/superpowers/specs/2026-07-27-emoji-sticker-reacao-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
