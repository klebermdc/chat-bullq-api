# Fatia 1 — Story Reply como Condição de Automação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que uma automação dispare só quando a mensagem for resposta ou menção a um Story, reproduzindo o fluxo "Turn story replies into leads" do ManyChat (29 execuções, CTR 37,9%).

**Architecture:** O dado já chega do adapter do Instagram e já é persistido em `Message.metadata.replyTo`. Falta só expô-lo ao motor de automação. A montagem do evento `MESSAGE_RECEIVED` está inline dentro de uma transação no processor, sem teste — a Task 1 extrai isso para uma função pura antes de mudar qualquer comportamento.

**Tech Stack:** NestJS, Prisma (PostgreSQL), Jest, Next.js (frontend).

**Spec:** `docs/superpowers/specs/2026-08-17-sair-do-manychat-design.md`

**Worktrees:**
- API: `.wt-story-kind-api`, branch `feat/automation-story-kind` (base: `fork/feat/conversation-tabs`)
- Web: `.wt-story-kind-web`, branch `feat/automation-story-kind` (base: `fork/feat/conversation-tabs`)

**Comando de teste:** `npm test -- <caminho>`

---

## Contexto que o implementador precisa saber

**O dado já existe.** O `instagram.message-mapper.ts` normaliza os dois casos em
`extractReplyContext`:

- resposta a story → `reply_to.story {id, url}` → `replyTo.story.kind = 'reply'`
- menção em story → `attachments[type=story_mention]` → `replyTo.story.kind = 'mention'`

E o processor persiste em `Message.metadata.replyTo`
(`inbound-message.processor.ts:656`). **Nada disso precisa mudar.**

**O que falta.** O evento `MESSAGE_RECEIVED` é montado à mão em
`inbound-message.processor.ts:253-281`, dentro de uma transação Prisma, e não
copia o campo. Uma automação hoje não distingue resposta de story de DM comum.

**Por que extrair antes de mudar.** Não existe spec para o
`inbound-message.processor.ts`. A lógica está dentro de um `tx` com dezenas de
dependências, impossível de testar sem subir meio módulo. Extrair a montagem
para uma função pura é pré-requisito de TDD aqui, não refatoração gratuita — e o
diff é pequeno porque a lógica já é autocontida.

**Sem `@Injectable`, sem módulo.** A função extraída é pura e exporta só uma
função. Isso importa: o projeto já derrubou produção duas vezes com ciclo de DI
(API #94, e o guarda em `di-cycle-guard-spec`). Uma função pura importada por
tipo não cria aresta no grafo de injeção.

**`storyKind` é `null` em todo canal que não tem Story.** WhatsApp e Messenger
sempre devolvem `null`. O campo é opcional por construção, não por descuido.

---

## Estrutura de arquivos

**Criar:**

| Arquivo | Responsabilidade |
|---|---|
| `src/modules/messaging/pipeline/message-received-payload.builder.ts` | Função pura: `NormalizedInboundMessage` → `MessageReceivedPayload` |
| `src/modules/messaging/pipeline/message-received-payload.builder.spec.ts` | Testes da função pura |
| `src/modules/automations/engine/conditions-evaluator.spec.ts` | Testes do registry de campos (não existe hoje) |

**Modificar:**

| Arquivo | Mudança |
|---|---|
| `src/modules/automations/automations.types.ts` | `storyKind` em `MessageReceivedPayload` |
| `src/modules/messaging/pipeline/inbound-message.processor.ts:253-281` | Chama a função extraída |
| `src/modules/automations/engine/conditions-evaluator.ts:80-87` | Expõe `storyKind` |
| `chat-bullq-web/src/features/automations/utils/labels.ts` | Rótulo e operadores do campo |
| `chat-bullq-web/src/features/automations/components/automation-builder.tsx:623` | Seletor de valor |

---

## Task 1: Extrair a montagem do evento para função pura

Sem mudança de comportamento. Só move a lógica para onde dá para testar.

**Files:**
- Create: `src/modules/messaging/pipeline/message-received-payload.builder.ts`
- Create: `src/modules/messaging/pipeline/message-received-payload.builder.spec.ts`
- Modify: `src/modules/messaging/pipeline/inbound-message.processor.ts:253-281`

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/modules/messaging/pipeline/message-received-payload.builder.spec.ts`:

```ts
import { buildMessageReceivedPayload } from './message-received-payload.builder';
import { NormalizedInboundMessage } from '../../channel-hub/ports/types';

const base = {
  organizationId: 'org-1',
  contactId: 'contact-1',
  conversationId: 'conv-1',
  channelId: 'chan-1',
  messageId: 'msg-1',
};

function message(over: Partial<NormalizedInboundMessage> = {}): NormalizedInboundMessage {
  return {
    externalMessageId: 'ext-1',
    from: 'user-1',
    to: 'page-1',
    timestamp: new Date('2026-08-17T12:00:00Z'),
    type: 'TEXT',
    content: { text: 'oi' },
    ...over,
  } as NormalizedInboundMessage;
}

describe('buildMessageReceivedPayload', () => {
  it('usa o texto como body', () => {
    const p = buildMessageReceivedPayload({ ...base, message: message() });
    expect(p.body).toBe('oi');
    expect(p.hasAttachment).toBe(false);
    expect(p.isFromCustomer).toBe(true);
  });

  it('cai na caption quando nao ha texto', () => {
    const p = buildMessageReceivedPayload({
      ...base,
      message: message({ type: 'IMAGE', content: { caption: 'olha isso' } as any }),
    });
    expect(p.body).toBe('olha isso');
    expect(p.hasAttachment).toBe(true);
  });

  it('devolve body null quando nao ha texto nem caption', () => {
    const p = buildMessageReceivedPayload({
      ...base,
      message: message({ type: 'AUDIO', content: {} as any }),
    });
    expect(p.body).toBeNull();
    expect(p.hasAttachment).toBe(true);
  });

  it('propaga os ids recebidos', () => {
    const p = buildMessageReceivedPayload({ ...base, message: message() });
    expect(p.organizationId).toBe('org-1');
    expect(p.contactId).toBe('contact-1');
    expect(p.conversationId).toBe('conv-1');
    expect(p.channelId).toBe('chan-1');
    expect(p.messageId).toBe('msg-1');
    expect(p.type).toBe('TEXT');
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npm test -- src/modules/messaging/pipeline/message-received-payload.builder.spec.ts`
Expected: FAIL com `Cannot find module './message-received-payload.builder'`

- [ ] **Step 3: Escrever a implementação**

Crie `src/modules/messaging/pipeline/message-received-payload.builder.ts`:

```ts
import { NormalizedInboundMessage } from '../../channel-hub/ports/types';
import { MessageReceivedPayload } from '../../automations/automations.types';

// Tipos de conteúdo que contam como anexo para efeito de condição de
// automação. Mantido como Set para a checagem não virar uma cadeia de ||.
const ATTACHMENT_TYPES = new Set([
  'IMAGE',
  'AUDIO',
  'VIDEO',
  'DOCUMENT',
  'STICKER',
]);

export interface BuildMessageReceivedPayloadParams {
  organizationId: string;
  contactId: string;
  conversationId: string;
  channelId: string;
  messageId: string;
  message: NormalizedInboundMessage;
}

// Função pura de propósito: sem @Injectable e sem módulo Nest, para não criar
// aresta no grafo de injeção (o projeto já caiu duas vezes por ciclo de DI).
export function buildMessageReceivedPayload(
  params: BuildMessageReceivedPayloadParams,
): MessageReceivedPayload {
  const { message } = params;
  const content = (message.content ?? {}) as Record<string, any>;

  const body =
    typeof content.text === 'string'
      ? content.text
      : typeof content.caption === 'string'
        ? content.caption
        : null;

  return {
    organizationId: params.organizationId,
    contactId: params.contactId,
    conversationId: params.conversationId,
    channelId: params.channelId,
    messageId: params.messageId,
    body,
    type: String(message.type),
    hasAttachment: ATTACHMENT_TYPES.has(String(message.type)),
    isFromCustomer: true,
  };
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npm test -- src/modules/messaging/pipeline/message-received-payload.builder.spec.ts`
Expected: PASS, 4 testes

- [ ] **Step 5: Trocar o inline do processor pela chamada**

Em `src/modules/messaging/pipeline/inbound-message.processor.ts`, substitua o
bloco das linhas 253-281 (de `const content = (message.content ?? {})` até o
fechamento do `enqueue`) por:

```ts
            await this.outbox.enqueue(
              tx,
              AutomationTrigger.MESSAGE_RECEIVED,
              buildMessageReceivedPayload({
                organizationId,
                contactId,
                conversationId,
                channelId,
                messageId: result.message.id,
                message,
              }),
            );
```

E adicione o import no topo do arquivo:

```ts
import { buildMessageReceivedPayload } from './message-received-payload.builder';
```

- [ ] **Step 6: Rodar a suíte do pipeline inteira**

Run: `npm test -- src/modules/messaging/pipeline`
Expected: PASS. Nenhum teste existente deve mudar de resultado — esta task não
muda comportamento.

- [ ] **Step 7: Commitar**

```bash
git add src/modules/messaging/pipeline/message-received-payload.builder.ts \
        src/modules/messaging/pipeline/message-received-payload.builder.spec.ts \
        src/modules/messaging/pipeline/inbound-message.processor.ts
git commit -m "refactor(automations): extrai montagem do MESSAGE_RECEIVED para funcao pura"
```

---

## Task 2: Adicionar `storyKind` ao payload

**Files:**
- Modify: `src/modules/automations/automations.types.ts`
- Modify: `src/modules/messaging/pipeline/message-received-payload.builder.ts`
- Modify: `src/modules/messaging/pipeline/message-received-payload.builder.spec.ts`

- [ ] **Step 1: Escrever os testes que falham**

> **Correção registrada na execução da Task 1.** O plano original supunha um
> shape de `NormalizedInboundMessage` que não existe (com `from`/`to`) e um
> caminho de import errado. O real é: import de `../../channel-hub/ports/types`,
> campos obrigatórios `externalMessageId`, `externalContactId`, `channelType`,
> `timestamp`, `type`, `content`, `rawPayload`. O helper `message()` já foi
> reescrito na Task 1 com assinatura `over: Partial<NormalizedInboundMessage>` e
> **sem nenhum cast**. Os blocos abaixo usam `as any` no argumento: **remova o
> cast** e passe `replyTo` tipado — se o `replyTo` não estiver no tipo
> `NormalizedInboundMessage`, pare e reporte, porque isso significaria que o
> adapter do Instagram devolve campo fora do contrato.

Acrescente ao `describe` em
`src/modules/messaging/pipeline/message-received-payload.builder.spec.ts`:

```ts
  it('marca storyKind=reply quando a mensagem responde a um story', () => {
    const p = buildMessageReceivedPayload({
      ...base,
      message: message({
        replyTo: { story: { id: 'story-9', url: 'https://cdn/x.jpg', kind: 'reply' } },
      } as any),
    });
    expect(p.storyKind).toBe('reply');
  });

  it('marca storyKind=mention quando a mensagem e mencao em story', () => {
    const p = buildMessageReceivedPayload({
      ...base,
      message: message({
        replyTo: { story: { url: 'https://cdn/x.jpg', kind: 'mention' } },
      } as any),
    });
    expect(p.storyKind).toBe('mention');
  });

  it('devolve storyKind null em DM comum', () => {
    const p = buildMessageReceivedPayload({ ...base, message: message() });
    expect(p.storyKind).toBeNull();
  });

  it('devolve storyKind null quando o replyTo e resposta a mensagem, nao a story', () => {
    const p = buildMessageReceivedPayload({
      ...base,
      message: message({ replyTo: { externalMessageId: 'mid-1' } } as any),
    });
    expect(p.storyKind).toBeNull();
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/modules/messaging/pipeline/message-received-payload.builder.spec.ts`
Expected: FAIL — 4 testes novos falham com `Property 'storyKind' does not exist`

- [ ] **Step 3: Declarar o campo no tipo**

Em `src/modules/automations/automations.types.ts`, dentro de
`MessageReceivedPayload`, logo abaixo de `hasAttachment`:

```ts
  // 'reply'   = a pessoa respondeu a um Story
  // 'mention' = a pessoa mencionou o perfil no Story dela
  // null      = DM comum, ou canal sem Story (WhatsApp, Messenger)
  storyKind: 'reply' | 'mention' | null;
```

- [ ] **Step 4: Preencher na função pura**

Em `message-received-payload.builder.ts`, dentro do objeto retornado, depois de
`hasAttachment`:

```ts
    storyKind: message.replyTo?.story?.kind ?? null,
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npm test -- src/modules/messaging/pipeline/message-received-payload.builder.spec.ts`
Expected: PASS, 8 testes

- [ ] **Step 6: Commitar**

```bash
git add src/modules/automations/automations.types.ts \
        src/modules/messaging/pipeline/message-received-payload.builder.ts \
        src/modules/messaging/pipeline/message-received-payload.builder.spec.ts
git commit -m "feat(automations): storyKind no payload do MESSAGE_RECEIVED"
```

---

## Task 3: Expor `storyKind` como campo de condição

**Files:**
- Create: `src/modules/automations/engine/conditions-evaluator.spec.ts`
- Modify: `src/modules/automations/engine/conditions-evaluator.ts:80-87`

- [ ] **Step 1: Escrever o teste que falha**

Crie `src/modules/automations/engine/conditions-evaluator.spec.ts`:

```ts
import { AutomationTrigger } from '@prisma/client';
import { FIELDS_BY_TRIGGER } from './conditions-evaluator';

describe('FIELDS_BY_TRIGGER', () => {
  const messageFields = () => FIELDS_BY_TRIGGER[AutomationTrigger.MESSAGE_RECEIVED];

  it('expoe storyKind para MESSAGE_RECEIVED', () => {
    expect(messageFields().storyKind).toBeDefined();
  });

  it('le storyKind do payload', () => {
    const payload = { storyKind: 'reply' } as any;
    expect(messageFields().storyKind(payload)).toBe('reply');
  });

  it('devolve null quando o payload nao tem storyKind', () => {
    const payload = { body: 'oi' } as any;
    expect(messageFields().storyKind(payload) ?? null).toBeNull();
  });

  it('mantem os campos que ja existiam', () => {
    const f = messageFields();
    expect(f.body).toBeDefined();
    expect(f.type).toBeDefined();
    expect(f.hasAttachment).toBeDefined();
    expect(f.channelId).toBeDefined();
  });
});
```

Nota sobre a forma: `FIELDS_BY_TRIGGER` é exportado em
`conditions-evaluator.ts:56` como `Record<AutomationTrigger, ...>`, e cada campo
é uma função acessora — `body: (p) => (p as any).body`. Por isso o teste acessa
`messageFields().storyKind(payload)`: o primeiro par de parênteses resolve o
helper local, o segundo chama a acessora.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- src/modules/automations/engine/conditions-evaluator.spec.ts`
Expected: FAIL — `expect(received).toBeDefined()` recebeu `undefined`

- [ ] **Step 3: Adicionar o campo ao registry**

Em `src/modules/automations/engine/conditions-evaluator.ts`, no bloco
`[AutomationTrigger.MESSAGE_RECEIVED]` (linha ~80), depois de `hasAttachment`:

```ts
    storyKind: (p) => (p as any).storyKind ?? null,
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npm test -- src/modules/automations/engine/conditions-evaluator.spec.ts`
Expected: PASS, 4 testes

- [ ] **Step 5: Rodar a suíte de automações inteira**

Run: `npm test -- src/modules/automations`
Expected: PASS

- [ ] **Step 6: Commitar**

```bash
git add src/modules/automations/engine/conditions-evaluator.ts \
        src/modules/automations/engine/conditions-evaluator.spec.ts
git commit -m "feat(automations): storyKind como campo de condicao"
```

---

## Task 4: Frontend — rótulo, operadores e seletor

Roda no worktree web (`.wt-story-kind-web`).

**Files:**
- Modify: `src/features/automations/utils/labels.ts`
- Modify: `src/features/automations/components/automation-builder.tsx:623`

- [ ] **Step 1: Adicionar o rótulo**

Em `src/features/automations/utils/labels.ts`, dentro de `FIELD_LABELS`, depois
de `hasAttachment: 'Tem anexo',`:

```ts
  storyKind: 'Resposta a Story',
```

- [ ] **Step 2: Restringir os operadores**

Ainda em `labels.ts`, dentro de `operatorsForField`, **acrescente uma condição
nova antes da de `hasAttachment`**, sem tocar nas existentes:

```ts
  // storyKind aceita is_set/is_not_set porque "é qualquer tipo de story" é a
  // regra mais útil do campo, e sem esses operadores ela não existe.
  if (field === 'storyKind') {
    return ['equals', 'not_equals', 'is_set', 'is_not_set'];
  }
```

Não altere a condição de `hasAttachment`/`target`. Mudar os operadores deles
alteraria automações que já estão no ar, e isso não faz parte desta fatia.

- [ ] **Step 3: Adicionar o seletor de valor**

Em `src/features/automations/components/automation-builder.tsx`, logo antes do
`case 'hasAttachment':` (linha ~623):

```tsx
    case 'storyKind':
      return (
        <select
          className={inputCls}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Selecione…</option>
          <option value="reply">Respondeu a um Story</option>
          <option value="mention">Mencionou em um Story</option>
        </select>
      );
```

- [ ] **Step 4: Verificar que compila**

Run: `npm run build`
Expected: build passa sem erro de tipo.

- [ ] **Step 5: Conferir na tela**

Suba o dev server, abra `/automations`, crie uma automação nova com gatilho
"Mensagem recebida" e confirme que:

- o campo "Resposta a Story" aparece na lista
- ao escolhê-lo, os operadores oferecidos são "igual a", "diferente de", "está
  preenchido" e "não está preenchido"
- ao escolher "igual a", o valor vira um seletor com as duas opções, não um
  campo de texto livre

- [ ] **Step 6: Commitar**

```bash
git add src/features/automations/utils/labels.ts \
        src/features/automations/components/automation-builder.tsx
git commit -m "feat(automations): campo Resposta a Story no builder"
```

---

## Task 5: Verificação ponta a ponta

- [ ] **Step 1: Criar a automação de teste**

Em `/automations`, crie:

- Gatilho: **Mensagem recebida**
- Condição: `Resposta a Story` **igual a** `Respondeu a um Story`
- Ação: **Adicionar tag** → uma tag nova chamada `Veio de Story`
- Estado: ativada

- [ ] **Step 2: Disparar de verdade**

De uma conta que não seja a `@orlando.fastpass`, responda a um Story do perfil
pelo aplicativo do Instagram.

- [ ] **Step 3: Conferir os três sinais**

1. A conversa aparece no inbox
2. O contato recebeu a tag `Veio de Story`
3. Em `/automations`, o painel de runs mostra um run com status `SUCCESS`

- [ ] **Step 4: Conferir o negativo**

Mande uma DM comum (não resposta a story) da mesma conta. O run **não** deve
disparar — se disparar, a condição está sendo ignorada e o campo não chegou ao
avaliador.

- [ ] **Step 5: Abrir os PRs**

Um PR por repositório, contra `fork/feat/conversation-tabs`. Nunca push direto
na branch viva.

```bash
gh pr create --base feat/conversation-tabs \
  --title "feat(automations): story reply como condicao" \
  --body "Expõe replyTo.story.kind ao motor de automação. Reproduz o fluxo 'Turn story replies into leads' do ManyChat (29 exec, CTR 37,9%).

Spec: docs/superpowers/specs/2026-08-17-sair-do-manychat-design.md

## Test plan
- [x] Testes unitários da função pura (8) e do registry de campos (4)
- [x] Suíte de messaging/pipeline e automations sem regressão
- [ ] E2E: responder Story aplica a tag; DM comum não dispara

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Critério de pronto

Uma automação com condição `storyKind equals reply` dispara quando alguém
responde a um Story e **não** dispara em DM comum, comprovado no painel de runs.
