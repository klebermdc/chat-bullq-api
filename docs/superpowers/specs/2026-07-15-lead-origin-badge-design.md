# Origem do Lead no Card (board + Card do Cliente) — Design

Data: 2026-07-15
Branch: `feat/lead-origin-badge` (base `fork/feat/conversation-tabs`)
Repos: `chat-bullq-api` + `chat-bullq-web`

## Problema

O card do lead — tanto o mini-card no board do pipeline quanto o Card do Cliente
(panorama que abre ao clicar) — não mostra **de onde o cliente veio**. Hoje a
única pista de origem que existe no dado é a tag `Instagram Orgânico`, aplicada
automaticamente pelo `LeadSourceTaggerService` na 1ª mensagem que casa a
frase-marca. Mas essa tag **não é serializada pelo `getBoard`**, então a UI nem
enxerga. Resultado: o operador não sabe a origem sem investigar.

## Objetivo

Mostrar um **selo de origem genérico em todo card** (board + panorama) e permitir
**corrigir a origem à mão** no Card do Cliente (para leads antigos ou que não
bateram a detecção automática, como a Priscila).

Fora de escopo: a atribuição estruturada CTWA (anúncio) vs Site (formulário) —
essa é a feature `lead-source-attribution`, que depende do número oficial da
Meta. O modelo aqui deixa "Anúncio"/"Site" reservados para encaixe futuro sem
retrabalho no card.

## Modelo de origem (via tags, SEM migração)

A origem é representada por um conjunto **canônico** de chaves, cada uma mapeada
a uma tag de conversa (ou a nenhuma tag, no caso do fallback):

| Chave              | Tag na conversa     | Como surge                                  |
|--------------------|---------------------|---------------------------------------------|
| `INSTAGRAM_ORGANIC`| `Instagram Orgânico`| auto (tagger) ou correção manual            |
| `WHATSAPP_DIRECT`  | *(nenhuma tag)*     | fallback: nenhuma tag de origem + canal WA  |
| `AD` (reservado)   | `Anúncio`           | futuro (CTWA)                               |
| `SITE` (reservado) | `Site`              | futuro (formulário)                         |

Só `INSTAGRAM_ORGANIC` é implementado agora (leitura + escrita). `AD`/`SITE`
ficam declarados na constante canônica, mas sem produtor de dado ainda.

### Resolução da origem (regra única, aplicada no front)

Ordem de prioridade:
1. **Tag de origem explícita** na conversa (ex.: `Instagram Orgânico`) → vence.
2. **Fallback pelo canal** da conversa:
   - canal `INSTAGRAM` → rótulo **"Instagram"**
   - canais `WHATSAPP_OFFICIAL | WHATSAPP_ZAPPFY | WHATSAPP_WASENDER` → **"WhatsApp direto"**

Assim **todo card sempre tem um selo** — nunca fica vazio.

## Backend (`chat-bullq-api`)

### 1. Serializar as tags no board
`pipelines.service.ts` → `getBoard`, no `include.conversation.select`
(hoje L94–105), adicionar:
```ts
tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
```
O Card do Cliente reusa o mesmo `CardSummary` do board, então isso cobre os dois
lugares de uma vez. Não mexer nos outros serializadores por ora (YAGNI); se o
card ficar defasado após um `moveCard`, tratar em follow-up.

### 2. Constante canônica compartilhada
Novo `src/modules/messaging/pipeline/lead-origin.constants.ts` exportando o mapa
`ORIGIN_TAG_NAMES` (`INSTAGRAM_ORGANIC → 'Instagram Orgânico'`, mais `AD`/`SITE`
reservados) e o tipo `LeadOriginKey`. O `LeadSourceTaggerService` passa a
importar `INSTAGRAM_TAG_NAME` daqui em vez de declarar local (fonte única).

### 3. Endpoint de correção manual
`PUT /conversations/:id/origin` no `conversations.controller.ts`
(mesmo guard stack `JwtAuthGuard, OrgGuard, RolesGuard` das outras rotas).
- Body: `{ origin: LeadOriginKey }` (validado por DTO; enum aceita
  `INSTAGRAM_ORGANIC | WHATSAPP_DIRECT` nesta fatia).
- Semântica **single-valued**: define exatamente uma origem. Numa transação:
  remove todas as tags de origem conhecidas da conversa e, se a origem escolhida
  tem tag (`INSTAGRAM_ORGANIC`), adiciona. `WHATSAPP_DIRECT` = remover todas
  (volta ao fallback). Idempotente.
- Implementado num `LeadOriginService` fino que escreve **direto no Prisma**
  (upsert da tag + `conversationTag` numa transação), espelhando o
  `LeadSourceTaggerService`. NÃO usa `TagsService` de propósito: aquele dispara
  automações `TAG_ADDED/TAG_REMOVED` no outbox, que não devem rodar numa
  correção manual de origem.
- Escopo/segurança: valida que a conversa é da org (via OrgGuard + checagem de
  `organizationId`). Liberado para qualquer papel que enxerga a conversa (mesma
  régua do `/transfer`).
- Retorna a lista de tags de origem resultante (pra UI atualizar sem refetch
  pesado), ou 204.

### Testes (TDD)
- `LeadOriginService`: setar INSTAGRAM_ORGANIC cria/linka a tag; setar
  WHATSAPP_DIRECT remove; idempotência (setar 2x); troca de origem remove a
  anterior. Escopo por org.
- Endpoint: 200/204 no happy path; 404 conversa de outra org; 400 origem
  inválida.
- Regressão: `getBoard` retorna `conversation.tags`.

## Frontend (`chat-bullq-web`)

### 1. Tipo
`pipelines.service.ts` → `CardSummary.conversation` ganha
`tags?: { tag: { id: string; name: string; color: string | null } }[]`.

### 2. Helper puro `resolveLeadOrigin(card)`
Novo arquivo (ex.: `features/pipelines/lib/lead-origin.ts`) com o mapa de
rótulos/estilo e a regra de resolução (tag explícita > canal). Retorna
`{ key, label, emoji, tone }`. Testável isoladamente.

### 3. Selo no mini-card
`kanban-card.tsx`: chip de origem na fileira de selos (bloco L115–162), ao lado
do termômetro. Estilo discreto (segue os chips existentes), com emoji + rótulo.

### 4. Card do Cliente
`client-card-dialog.tsx`:
- Linha/section **"Origem"** no cabeçalho mostrando o selo resolvido.
- Seletor de **correção manual** (dropdown: `Instagram Orgânico`,
  `WhatsApp direto`) que chama `PUT /conversations/:id/origin`, invalida a query
  `['pipeline-board', pipelineId]` e mostra o novo selo. Optimistic opcional.

## Deploy
- Branch própria `feat/lead-origin-badge` + **PR** para `feat/conversation-tabs`
  (nunca push direto — ver `deploy-via-pr-nao-push-direto`).
- **Sem migração** (só leitura de tag + select novo + escrita via tag existente).
- Tagger `Instagram Orgânico` **já está vivo** na branch de deploy (confirmado em
  `fork/feat/conversation-tabs`) — não precisa levar #61.
- Build API (`nest build`) + web (`tsc`) verdes; testes novos verdes.

## Limitações aceitas
- Leads antigos sem tag aparecem como "WhatsApp direto" até correção manual.
- `AD`/`SITE` só ganham produtor de dado quando a feature CTWA/Site ligar.
- Fallback usa o canal, que é uma aproximação de origem (não a origem real).
