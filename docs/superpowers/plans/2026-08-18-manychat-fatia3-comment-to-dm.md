# Fatia 3 — Comment-to-DM

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando alguém comenta num post ou Reel, o sistema abre uma DM privada a partir do comentário, aplica etiqueta e registra a origem — reproduzindo o motor da conta ManyChat (~137 execuções, 37% do total, os quatro fluxos de maior volume).

**Architecture:** Porta nova no `channel-hub` paralela à de mensagem. O payload de comentário chega em `entry[].changes[]`, não em `entry[].messaging[]`, então o gateway existente desvia para ela. Contato é resolvido pelo `from.id` (mesmo IGSID/PSID do DM), um `SocialComment` enxuto é gravado para idempotência, e um evento `COMMENT_RECEIVED` entra no outbox. Daí pra frente é o motor de automação que já existe.

**Tech Stack:** NestJS, Prisma (PostgreSQL), Jest, Meta Graph API v21.0.

**Spec:** `docs/superpowers/specs/2026-08-17-sair-do-manychat-design.md`

**Comando de teste:** `npx jest <caminho>`

---

## LEIA ISTO ANTES DE COMEÇAR

### Cinco tarefas dão para fazer agora. Três não.

As Tasks 1 a 5 não dependem de nenhum dado externo — são modelo, gatilho, ações e UI. **Podem ser executadas imediatamente.**

As Tasks 6 a 8 dependem do resultado da **Fatia 0 (sonda de permissão)**, cujo plano está em `docs/superpowers/plans/2026-08-17-manychat-fatia0-sonda-permissao.md`. Elas estão marcadas com **BLOQUEADA** e dizem exatamente o que falta.

**Não tente executar as Tasks 6-8 sem o documento de veredito da sonda.** Escrever um parser de webhook contra um payload inventado é o defeito que este projeto já cometeu cinco vezes nesta série de planos — inclusive tipos de anexo (`post`, `ig_post`) que simplesmente não existem na plataforma.

### A regra que salvou as fatias anteriores

Onde existir equivalente no adapter do Instagram, que **está em produção**, copie de lá. O plano é ponto de partida, não fonte de verdade. Cinco erros reais desta série foram pegos exatamente assim.

### O que já existe e deve ser reusado

| Peça | Onde |
|---|---|
| Assinatura HMAC + handshake | `channel-hub/adapters/meta-shared/meta-signature.util.ts` |
| Motor de automação (outbox, lock por contato, cascade, auto-disable) | `modules/automations/` |
| Registry de campos de condição | `automations/engine/conditions-evaluator.ts` (`FIELDS_BY_TRIGGER`) |
| Validador de campo no salvamento | `automations/automations.validator.ts` — lê o MESMO mapa, não há whitelist paralela |
| Molde de handler de ação | `automations/actions/handlers/add-tag.handler.ts` |
| Resolução de contato por `(channelId, externalId)` | pipeline de entrada |

---

## Task 1: Modelo `SocialComment`

O comentário **não vira conversa**. Guardamos o mínimo para idempotência e atribuição — sem tela, sem inbox.

**A unicidade é a peça funcional, não higiene:** a Meta reentrega webhook. Sem ela, a mesma pessoa recebe a DM duas vezes.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_social_comment/migration.sql`

- [ ] **Step 1: Adicionar o modelo**

```prisma
model SocialComment {
  id             String   @id @default(cuid())
  organizationId String   @map("organization_id")
  channelId      String   @map("channel_id")

  // ID do comentário na Meta. Único por canal — é o que barra a DM dupla
  // quando a Meta reentrega o webhook.
  externalCommentId String @map("external_comment_id")
  // Presente quando é resposta a outro comentário, não comentário raiz.
  parentCommentId   String? @map("parent_comment_id")

  postId        String  @map("post_id")
  postPermalink String? @map("post_permalink")

  // Mesmo IGSID/PSID do DM — é o que permite casar comentário e conversa.
  authorExternalId String  @map("author_external_id")
  authorUsername   String? @map("author_username")
  contactId        String  @map("contact_id")

  text      String
  createdAt DateTime @map("created_at")

  // Resposta privada: uma por comentário, dentro de 7 dias (regra da Meta).
  privateReplyAt    DateTime? @map("private_reply_at")
  privateReplyError String?   @map("private_reply_error")
  publicReplyAt     DateTime? @map("public_reply_at")

  ingestedAt DateTime @default(now()) @map("ingested_at")

  channel Channel @relation(fields: [channelId], references: [id], onDelete: Cascade)
  contact Contact @relation(fields: [contactId], references: [id], onDelete: Cascade)

  @@unique([channelId, externalCommentId], map: "uq_social_comment_channel_external")
  @@index([organizationId, createdAt])
  @@index([contactId])
  @@map("social_comments")
}
```

Acrescente as relações inversas em `Channel` e `Contact`.

- [ ] **Step 2: Gerar a migração**

`npx prisma migrate dev --name add_social_comment --create-only`

- [ ] **Step 3: Regenerar o client e verificar tipos**

`npx prisma generate && npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): modelo SocialComment com unicidade por canal"
```

---

## Task 2: Gatilho `COMMENT_RECEIVED`

**Files:**
- Modify: `prisma/schema.prisma` (enum `AutomationTrigger`)
- Modify: `src/modules/automations/automations.types.ts`
- Modify: `src/modules/automations/engine/conditions-evaluator.ts`
- Modify: `src/modules/automations/engine/conditions-evaluator.spec.ts`

> **Pegadinha do projeto:** `ALTER TYPE ... ADD VALUE` e o **uso** do valor novo na MESMA migração quebram o `prisma migrate deploy`. Aqui só adicionamos, então está seguro — mas não use `COMMENT_RECEIVED` em nenhum DDL desta migração.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao `conditions-evaluator.spec.ts` (que já existe, com 18 testes):

```typescript
describe('FIELDS_BY_TRIGGER — COMMENT_RECEIVED', () => {
  const commentFields = () => FIELDS_BY_TRIGGER[AutomationTrigger.COMMENT_RECEIVED];

  it('expoe os campos de condicao do comentario', () => {
    const f = commentFields();
    expect(f.body).toBeDefined();
    expect(f.postId).toBeDefined();
    expect(f.isReply).toBeDefined();
    expect(f.channelId).toBeDefined();
    expect(f.contactId).toBeDefined();
  });

  it('le o texto do comentario em body', () => {
    expect(commentFields().body({ body: 'quero preco' } as any)).toBe('quero preco');
  });

  it('nao expoe commentId como campo de condicao', () => {
    // Condicionar por ID de comentario nao tem uso real e polui a UI.
    expect(commentFields().commentId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

`npx jest src/modules/automations/engine/conditions-evaluator.spec.ts`

- [ ] **Step 3: Adicionar o valor ao enum**

Em `prisma/schema.prisma`, no enum `AutomationTrigger`, depois de `LEAD_QUALIFIED`:

```prisma
  // Comentário em post/Reel. NÃO gera conversa — o comentário é público e
  // 1-para-muitos; a conversa nasce depois, quando a private reply for
  // respondida.
  COMMENT_RECEIVED
```

Gere a migração com `--create-only` e regenere o client.

- [ ] **Step 4: Declarar o payload**

Em `automations.types.ts`:

```typescript
export interface CommentReceivedPayload extends BaseEventPayload {
  channelId: string;
  commentId: string;
  postId: string;
  body: string;
  // true = resposta a outro comentário; false = comentário raiz no post.
  isReply: boolean;
}
```

Acrescente à união `AutomationEventPayload` e ao mapa `TriggerToPayload`.

**Note que não há `conversationId`** — comentário não tem conversa. Confirme que o `BaseEventPayload` o tem como opcional; se for obrigatório, pare e reporte.

- [ ] **Step 5: Expor os campos de condição**

Em `conditions-evaluator.ts`, no `FIELDS_BY_TRIGGER`:

```typescript
  [AutomationTrigger.COMMENT_RECEIVED]: {
    body: (p) => (p as any).body,
    postId: (p) => (p as any).postId,
    isReply: (p) => (p as any).isReply,
    channelId: (p) => p.channelId,
    contactId: (p) => p.contactId,
  },
```

- [ ] **Step 6: Rodar e commitar**

`npx jest src/modules/automations` e `npx tsc --noEmit`.

```bash
git add prisma/schema.prisma prisma/migrations/ \
        src/modules/automations/automations.types.ts \
        src/modules/automations/engine/conditions-evaluator.ts \
        src/modules/automations/engine/conditions-evaluator.spec.ts
git commit -m "feat(automations): gatilho COMMENT_RECEIVED"
```

---

## Task 3: Ação `send_private_reply`

O núcleo da fatia. `POST /{comment-id}/private_replies` abre uma DM a partir do comentário.

**Duas regras da Meta que o código precisa respeitar:**
- **Uma resposta privada por comentário.** A segunda tentativa é recusada.
- **Sete dias.** Depois disso a Meta recusa.

**Files:**
- Create: `src/modules/automations/actions/handlers/send-private-reply.handler.ts`
- Create: `src/modules/automations/actions/handlers/send-private-reply.handler.spec.ts`
- Modify: `src/modules/automations/actions/action-registry.service.ts`

- [ ] **Step 1: Escrever os testes que falham**

Cubra, no mínimo:

1. sucesso → grava `privateReplyAt` no `SocialComment`
2. comentário que já tem `privateReplyAt` → **não chama a Meta**, devolve resultado de "já respondido" sem erro
3. erro da Meta → grava o **motivo real** em `privateReplyError`, não `"Request failed with status code 400"`
4. comentário de outra organização → recusa (defesa contra config obsoleta, igual ao `add_tag`)
5. `validateParams` exige `message` string não vazia

O teste 2 é o que impede DM dupla. O teste 3 repete a lição da API #154 — o motivo real da Meta ficava invisível, só aparecia no log do container.

- [ ] **Step 2: Rodar e confirmar que falha**

- [ ] **Step 3: Implementar**

Siga o molde de `add-tag.handler.ts`: `readonly type`, `readonly continueOnErrorDefault`, `validateParams`, `execute(params, ctx)`.

```typescript
interface SendPrivateReplyParams {
  message: string;
}
```

`continueOnErrorDefault` deve ser `false` — é ação que muda estado externo; se falhar, parar o run é mais seguro que seguir aplicando etiquetas como se a DM tivesse saído.

O handler precisa: ler o `SocialComment` pelo `commentId` do payload, checar `privateReplyAt`, chamar o cliente HTTP do canal pelo registry de adapters, e gravar o resultado.

**Para o motivo real do erro:** veja como o adapter de saída do Messenger faz — ele já resolve isso (`wrapGraphError`). Reuse, não reinvente.

- [ ] **Step 4: Registrar no `action-registry.service.ts`**

- [ ] **Step 5: Rodar tudo e commitar**

```bash
git commit -m "feat(automations): acao send_private_reply com guarda de resposta unica"
```

---

## Task 4: Ação `reply_public_comment`

Réplica pública no thread do comentário: `POST /{comment-id}/replies`.

**Files:**
- Create: `src/modules/automations/actions/handlers/reply-public-comment.handler.ts` + spec
- Modify: `src/modules/automations/actions/action-registry.service.ts`

- [ ] **Step 1: Testes**

Mesma estrutura da Task 3, mais **um teste específico e importante**:

```typescript
it('nao responde comentario do proprio perfil', () => {
  // Sem isso o bot responde a si mesmo em laco. O MAX_CASCADE_DEPTH existe
  // como segunda rede, mas depender dele significa gerar 4 respostas
  // publicas antes de parar — visivel para todo mundo.
});
```

- [ ] **Step 2-4:** implementar, registrar, commitar.

```bash
git commit -m "feat(automations): acao reply_public_comment com guarda anti-laco"
```

---

## Task 5: Frontend — gatilho e ações no builder

**Files** (repositório **web**, worktree separado):
- Modify: `src/features/automations/utils/labels.ts`
- Modify: `src/features/automations/components/automation-builder.tsx`

- [ ] **Step 1: Rótulos**

```typescript
// TRIGGER_LABELS
COMMENT_RECEIVED: 'Comentário recebido',

// TRIGGER_DESCRIPTIONS
COMMENT_RECEIVED: 'Quando alguém comentar num post ou Reel',

// ACTION_LABELS
send_private_reply: 'Responder no privado (DM)',
reply_public_comment: 'Responder no comentário',

// FIELD_LABELS
postId: 'Post ou Reel',
isReply: 'É resposta a outro comentário',
```

- [ ] **Step 2: Operadores de `isReply`**

É booleano — acrescente uma condição própria em `operatorsForField` devolvendo `['equals', 'not_equals']`. **Não altere as condições existentes** de `hasAttachment`/`target`/`storyKind`.

- [ ] **Step 3: Seletor de valor de `isReply`**

`case 'isReply'` no switch, espelhando o `case 'hasAttachment'` (Sim/Não).

- [ ] **Step 4: Configuração das ações novas**

As duas ações têm um parâmetro `message` de texto livre. Veja como o `send_message` já é configurado no builder e siga o mesmo padrão.

**Atenção:** o `TRIGGER_LABELS` do web hoje está **desatualizado** em relação ao backend — falta `CONVERSATION_CREATED` e `LEAD_QUALIFIED`. Não conserte agora (fora de escopo), mas confirme que a ausência não quebra a tipagem ao adicionar o valor novo.

- [ ] **Step 5: `npx tsc --noEmit` e commit**

---

## Task 6 — BLOQUEADA: `parseComment`

**Depende de:** documento de veredito da Fatia 0, com o payload literal capturado.

**Por que está bloqueada:** o parser precisa do formato exato de `entry[].changes[]` — nomes de campo, onde vive o `from.id`, se o permalink vem, como o comentário-resposta se distingue do raiz. Cinco erros desta série de planos vieram de eu ter suposto formato em vez de olhar. Um parser contra payload inventado não roda.

**O que desbloqueia:** a seção `## Payload de comentário recebido` do documento
`docs/superpowers/notes/2026-08-17-sonda-comentarios.md`.

Quando existir, esta task escreve:
- `src/modules/channel-hub/ports/comment-inbound.port.ts` com o contrato `NormalizedComment`
- `messenger.comment-mapper.ts` e/ou `instagram.comment-mapper.ts` com testes contra o payload REAL
- o campo `isFromPageItself`, que é o que impede o laço de auto-resposta

---

## Task 7 — BLOQUEADA: desvio no gateway

**Depende de:** Task 6.

O gateway (`webhook-gateway.controller.ts`) passa a olhar `entry[].changes[]` além de `entry[].messaging[]`, e despacha para a porta de comentário. Nenhum controller novo.

Sequência de entrada, já desenhada no spec:

```
webhook → gateway → changes[] → parseComment → resolve canal
        → valida assinatura (meta-shared) → resolve/cria contato
        → upsert SocialComment → [já existia? PARA]
        → enqueue COMMENT_RECEIVED → motor → ações
```

**O contato é resolvido ANTES de enfileirar** — `contactId` é a chave do lock por contato, e o outbox recusa evento sem ele.

**O contato nasce sem conversa.** Quem só comentou não tem thread de DM. Criar conversa vazia produziria item fantasma no inbox — o mesmo defeito que o spec do Messenger rejeitou por escrito.

---

## Task 8 — BLOQUEADA: verificação de ponta a ponta

**Depende de:** Tasks 6 e 7, mais deploy.

Comentar num post real de uma conta que não seja a da empresa, com uma palavra que case a regra, e confirmar: a DM chega, o contato ganha a etiqueta, o painel de runs mostra `SUCCESS`, e **comentar de novo no mesmo comentário não gera segunda DM**.

O último é o que prova a idempotência valer em produção, não só em teste.

---

## Fora de escopo

- Tela de moderação de comentários e métrica de CTR por post
- Threads e Lead Generation Ads
- Migração dos 2.229 contatos do ManyChat — contato resolve só por `(channelId, externalId)`; CSV sem PSID/IGSID vira base fantasma. Fatia própria.

## Critério de pronto

Um comentário com a palavra configurada gera uma DM, uma vez só, com o contato etiquetado e a origem registrada — e a reentrega do mesmo webhook pela Meta não gera a segunda.
