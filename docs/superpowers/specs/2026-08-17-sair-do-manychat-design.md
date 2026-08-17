# Sair do ManyChat — Design

**Data:** 2026-08-17
**Base:** `fork/feat/conversation-tabs` (branch viva)
**Origem:** auditoria da conta ManyChat `328790557879731` (`sendturmanychatblueprint.html`)

## Problema

A captação de leads da Orlando Fast Pass roda no ManyChat. Para desligar a
ferramenta sem perder captação, o OFP Chat precisa reproduzir os gatilhos que
sustentam a conta hoje.

Somando as execuções por tipo de gatilho, da tabela da própria auditoria:

| Gatilho | Execuções | Estado no OFP |
|---|---|---|
| Keyword em DM | ~155 (42%) | **Pronto** — `MESSAGE_RECEIVED` + condição `body contains` |
| Comentário em post/Reel | ~137 (37%) | **Ausente** — sem webhook, sem gatilho, sem ação |
| Resposta padrão | 36 (10%) | Pronto (Aline) |
| Resposta a Story | ~30 (8%) | **Quase** — o dado chega e é persistido, mas não é exposto |

O motor de automação daqui é mais capaz que o do ManyChat: outbox transacional,
lock por contato, `delay` com watchdog de retomada, `MAX_CASCADE_DEPTH`,
auto-disable após 5 falhas, painel de runs e builder em `/automations`. **O que
falta é entrada de evento, não motor.**

## Objetivo

Cobrir os gatilhos que faltam para que pausar o ManyChat não derrube a
captação.

## Como este spec vira plano

Isto é um programa, não uma fatia. **Cada fatia recebe seu próprio plano de
implementação e seu próprio PR**; nenhuma delas depende de outra estar mergeada,
com uma exceção registrada na Fatia 2. Ordem recomendada: 0 → 1 → 2 → 3, porque
a 0 é barata e muda o cronograma da 3, e a 1 entrega valor com o menor diff do
conjunto.

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Onde o comentário entra | Porta nova no `channel-hub` | Reusa gateway, assinatura, resolução de canal e de contato |
| Comentário vira conversa? | **Não** | Mesma razão que o spec do Messenger rejeitou evento sem mensagem: produz item fantasma no inbox |
| O que a automação pode fazer | DM privada, réplica pública, etiquetar | As três como **ações**; quem monta a regra escolhe |
| Tela de moderação | Fora de escopo | Não pedida. Persistência existe só para idempotência |
| Tenancy | Só OFP agora | Permissão não aprovada funciona em ativo onde o usuário tem cargo no app |
| Ordem | Sonda antes de tudo | A resposta muda o cronograma de dias para semanas |

## Estado das permissões na Meta

Levantado via Meta DevTools MCP no app `1498969635088115` (Orlando Fast Pass),
em 17/08/2026:

| Permissão | Estado |
|---|---|
| `whatsapp_business_messaging` / `_management` | live, advanced |
| `instagram_manage_comments` | **REJECTED**, fora da submissão atual |
| `instagram_business_basic` | REJECTED, no rascunho |
| `instagram_business_manage_messages` | REJECTED, no rascunho |
| `instagram_business_manage_comments` | **nunca pedida** |
| `pages_read_engagement` | REJECTED |

`submission_status` = **`UNSUBMITTED`**: existe um rascunho (`1614258483559229`)
parado, nunca enviado. Webhooks assinados no app: só `whatsapp_business_account`
— nenhum tópico de Instagram ou de Página.

**Hipótese a testar, não a assumir:** a regra da Meta é que permissão não
aprovada funciona em ativos onde o usuário tem cargo no app (admin/dev/tester).
É a explicação mais provável para o Instagram já operar no OFP Chat hoje apesar
de `instagram_business_basic` constar REJECTED. Se confirmada, o comment-to-DM
liga sem esperar App Review — mas isso vale só enquanto a operação for a conta
da própria OFP. No Sendtur multi-tenant, conta de cliente sem cargo no app exige
permissão aprovada, sem exceção.

---

# Fatia 0 — Sonda de permissão

Sem código de produção.

Assinar o tópico `comments` no app, comentar num post real, verificar se o
webhook chega e se `POST /{comment-id}/private_replies` devolve 200 com o token
atual.

**Entregável:** veredito em cinco linhas. Se falhar, o subproduto é o rascunho
de submissão corrigido — incluindo `instagram_business_manage_comments`, que
hoje não está nele.

Esta fatia existe porque nenhuma leitura de documentação substitui o teste, e a
resposta decide se a Fatia 3 é trabalho de dias ou de semanas.

---

# Fatia 1 — Story reply como condição

## O que já existe

O adapter do Instagram já normaliza os dois casos em
`instagram.message-mapper.ts:52`:

- resposta a story → `reply_to.story {id, url}` → `replyTo.story.kind = 'reply'`
- menção em story → `attachments[type=story_mention]` → `kind = 'mention'`

E o processor já persiste isso em `Message.metadata.replyTo`
(`inbound-message.processor.ts:656`).

## O que falta

O evento `MESSAGE_RECEIVED` é montado à mão em
`inbound-message.processor.ts:268` e não copia o campo. Sem ele, uma automação
não consegue distinguir resposta de story de DM comum.

## Mudança

| Arquivo | Mudança |
|---|---|
| `automations.types.ts` | `storyKind?: 'reply' \| 'mention' \| null` em `MessageReceivedPayload` |
| `inbound-message.processor.ts` | Preenche de `message.replyTo?.story?.kind ?? null` |
| `engine/conditions-evaluator.ts` | Expõe `storyKind` no mapa de `MESSAGE_RECEIVED` |
| `features/automations/utils/labels.ts` | Rótulo no builder |

Sem migração, sem schema, sem adapter. `storyKind` é `null` em todo canal que
não tem story — o campo é opcional por construção.

## Testes

Mensagem com `replyTo.story.kind='reply'` produz evento com `storyKind='reply'`;
menção produz `'mention'`; DM comum produz `null`; condição
`storyKind equals reply` casa e não casa nos casos certos.

---

# Fatia 2 — Canal Messenger

Já desenhada. Vale o spec `2026-08-17-messenger-channel-design.md` e o plano
`2026-08-17-messenger-canal-1-nucleo.md`, sem alteração.

Registro aqui apenas a relação nova descoberta neste design:

- É **pré-requisito** do comentário na Página do Facebook (o parse do `feed`
  precisa do Page Access Token e do adapter registrado).
- **Não** é pré-requisito do comentário no Instagram.

---

# Fatia 3 — Comment-to-DM

## Arquitetura

### Porta nova

`src/modules/channel-hub/ports/comment-inbound.port.ts`

```ts
parseComment(payload: unknown): NormalizedComment | null
```

Implementada pelo adapter do Instagram e pelo do Messenger. Retorna `null` para
payload que não é comentário — o gateway trata `null` como "ignorar", nunca como
erro.

### Contrato

```ts
interface NormalizedComment {
  externalCommentId: string;
  parentCommentId?: string;      // presente quando é resposta a outro comentário
  postId: string;
  postPermalink?: string;
  authorExternalId: string;      // mesmo IGSID/PSID do DM — é o que casa com o Contact
  authorUsername?: string;
  text: string;
  createdAt: Date;
  isFromPageItself: boolean;     // comentário do próprio perfil
}
```

### Desvio no gateway existente

Nenhum controller novo. O payload da Meta traz comentário em `entry[].changes[]`,
não em `entry[].messaging[]`:

| Origem | Onde vem | Campo |
|---|---|---|
| Instagram | `entry[].changes[]` | `field: 'comments'` |
| Página do Facebook | `entry[].changes[]` | `field: 'feed'` + `value.item: 'comment'` |

`messaging[]` segue intocado no caminho de mensagem. O mesmo desvio cobre os
dois canais — cai uma vez, serve Instagram e Página.

### Modelo

```
SocialComment
  id, organizationId, channelId
  externalCommentId        @@unique([channelId, externalCommentId])
  parentCommentId?, postId, postPermalink?
  authorExternalId, contactId
  text, createdAt
  privateReplyAt?, publicReplyAt?, privateReplyError?
```

Sem tela. **A unicidade é a peça funcional**, não um detalhe de higiene: a Meta
reentrega webhook, e sem ela a mesma pessoa recebe a DM duas vezes.

### Gatilho e ações

Trigger `COMMENT_RECEIVED`, payload:

```ts
{ organizationId, contactId, channelId, commentId, postId, body, isReply }
```

Campos de condição expostos: `body`, `postId`, `isReply`, `channelId`,
`contactId`.

Ações novas no registry:

| Ação | Chamada | Regra |
|---|---|---|
| `send_private_reply` | `POST /{comment-id}/private_replies` | Uma vez por comentário, 7 dias. Marca `privateReplyAt` |
| `reply_public_comment` | `POST /{comment-id}/replies` | Marca `publicReplyAt` |

`add_tag`, `add_to_pipeline` e `assign_user` já existem e funcionam sem
alteração, porque o payload resolve `contactId`.

## Fluxo de dados

```
webhook → gateway → changes[] → parseComment → resolve canal
        → valida assinatura (meta-shared) → resolve/cria contato
        → upsert SocialComment → [já existia? PARA]
        → enqueue COMMENT_RECEIVED → motor → ações
```

O contato é resolvido **antes** de enfileirar porque `contactId` é a chave do
lock por contato: o outbox recusa evento sem ele.

**O contato nasce sem conversa.** Quem só comentou não tem thread de DM: o
`Contact` é criado a partir de `authorExternalId` (+ `authorUsername` quando a
Meta manda), e nenhuma `Conversation` é aberta nesse momento. A conversa nasce
depois, pelo caminho normal de inbound, quando a private reply for respondida.
Criar conversa vazia no momento do comentário produziria item fantasma no
inbox — o mesmo defeito que o spec do Messenger rejeitou.

### Casamento comentário → conversa

O `from.id` do comentário é o mesmo IGSID/PSID do DM. Quando a private reply
abre a conversa, a resolução de contato por `(channelId, externalId)` cai no
mesmo `Contact` sozinha, sem código novo. O `SocialComment.contactId` preserva a
origem para atribuição.

## Erros

- **Comentário do próprio perfil** (`isFromPageItself`) → ignorado. Sem isso o
  bot responde a si mesmo em laço.
- **Private reply fora dos 7 dias, ou já usada** → grava `privateReplyError` com
  o motivo real devolvido pela Meta, não o `"Request failed with status code
  400"` genérico. Mesma lição da API #154.
- **Comentário apagado antes da resposta** → 400 da Meta, grava e segue.
- **Payload desconhecido** → 200 + log. Nunca 500: a Meta desativa a assinatura
  após falhas repetidas.
- **Reentrega** → barrada pelo unique, antes de qualquer ação.
- **Réplica pública reentrando como comentário novo** → `isFromPageItself`
  filtra; `MAX_CASCADE_DEPTH` já existe como segunda rede.

## Testes

**`parseComment`:** comentário do Instagram; resposta aninhada
(`parentCommentId` presente); comentário do próprio perfil; payload `feed` da
Página; payload que não é comentário (retorna `null`).

**Idempotência:** mesmo payload duas vezes → um `SocialComment`, uma DM.

**Private reply:** sucesso marca `privateReplyAt`; erro grava
`privateReplyError` com o motivo real; segunda tentativa no mesmo comentário é
barrada.

**Condições:** `body contains` casa no texto do comentário.

**Regressão:** webhook com `messaging[]` continua indo para o caminho de
mensagem, sem desvio.

---

## Fora de escopo

- Tela de moderação de comentários e métricas de CTR por post
- Threads e Lead Generation Ads
- **Migração dos 2.229 contatos do ManyChat.** Contato aqui resolve só por
  `(channelId, externalId)`; um CSV exportado sem PSID/IGSID não casa com
  ninguém e produz base fantasma. É fatia própria, com decisão própria.
- Reconectar o WhatsApp no ManyChat e consertar a meta de IA de lá — a auditoria
  recomenda ambos, mas são trabalho jogado fora se a decisão é pausar a
  ferramenta. A operação de WhatsApp já roda inteira aqui.
