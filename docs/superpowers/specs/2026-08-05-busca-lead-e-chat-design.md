# Busca de lead e busca no histórico da conversa — design

**Data:** 2026-08-05
**Status:** aprovado

## Problema

Leads antigos não são localizáveis pela busca do inbox, e o histórico de uma
conversa longa é inacessível.

### Sintoma relatado

"Leads antigos que não consigo localizar."

### Causa raiz — a busca roda dentro da aba selecionada

1. `conversation-list.tsx` inicia com `tab = 'waiting'` (aba **Esperando**).
2. Digitar na busca não troca a aba — `handleSearchChange` só seta o texto.
3. A request manda `search` **e** `tab` juntos.
4. Na API, `tab=waiting` vira `awaitingHumanReply: true` + `excludeClosed: true`;
   `tab=inbox` vira `awaitingHumanReply: false` + `excludeClosed: true`.
5. No repositório, `excludeClosed` vira `where.status = { not: CLOSED }` e o
   `search` entra como **AND** por cima.

Resultado: conversa `CLOSED` — o estado normal de um lead antigo — nunca aparece
na busca das abas Esperando e Entrada. Só na aba Finalizados, e nada na interface
diz isso.

### Causas secundárias, mesmo sintoma

- **Telefone não normaliza.** O telefone é gravado em dígitos puros
  (`5511982015967`, via `normalizePhone`), e a busca faz `contains` com o termo
  cru. Buscar `(11) 98201-5967` não acha.
- **Arquivadas fora por padrão** (`archived: 'exclude'`).
- **`where.OR` sobrescrito.** O bloco do `search` faz `where.OR = [...]`,
  apagando o `where.OR` que o filtro de etiquetas montou logo acima. Etiqueta +
  busca ao mesmo tempo descarta a etiqueta em silêncio.

### Problema adjacente — o histórico da conversa

`chat-panel.tsx` chama `getMessages(conversation.id)` sem paginação: página 1,
limite 50, sem "carregar mais antigas". O `pagination.total` que a API devolve
nunca é usado. Conversa com mais de 50 mensagens tem o começo inacessível, e
qualquer refetch (`refetchOnWindowFocus`, reconexão do socket, os ~7
`invalidateQueries`) devolve a lista às últimas 50.

### O que NÃO é o problema

Nenhuma mensagem foi apagada. Não existe `delete`/`deleteMany` de mensagem nem
job de retenção. O único delete é `DELETE /conversations/:id`, que exige
`?confirm=<nome ou telefone exato do contato>` — ação manual e deliberada.

## Escopo

Busca de lead por **nome, telefone e protocolo**. Busca por conteúdo de mensagem
fica restrita ao escopo de uma conversa (Fatia 2); busca global por conteúdo está
**fora de escopo**.

---

## Fatia 1 — a busca do inbox acha em tudo

### Web — `conversation-list.tsx`

Com texto na busca, o escopo muda:

- não manda `tab`;
- manda `archived=any`;
- ignora o status herdado da aba.

Filtros escolhidos à mão (canal, etiqueta, responsável, período, status
explícito) continuam valendo — escolha deliberada se respeita.

Um selo abaixo do campo informa o escopo ampliado, para a mudança não ser
invisível.

### API — `conversations.repository.ts`

1. **Telefone normalizado.** Extrai os dígitos do termo e casa contra
   `contact.phone`. A cláusula de telefone só entra se o termo tiver 3+ dígitos,
   para não casar lixo.
2. **`where.OR` deixa de ser sobrescrito.** Busca e etiqueta viram dois blocos
   `OR` dentro de um `AND`.

Sem migração e sem índice novo.

---

## Fatia 2 — histórico completo e busca dentro do chat

### API — módulo `messages`

| Rota | Função |
|------|--------|
| `GET /messages?before=<messageId>` | cursor das anteriores (o `page` atual continua, a public-api depende dele) |
| `GET /messages?around=<messageId>` | janela de N antes + âncora + N depois |
| `GET /messages/search?conversationId=&q=` | procura em `content->>'text'` e `content->>'caption'` |

A busca respeita o escopo da timeline: a conversa e suas irmãs de segmento, pela
mesma regra de `groupSiblingIds`. Devolve id, data, direção e trecho, do mais
recente para o mais antigo, limite 50.

**Sem extensão e sem índice novo.** O filtro por `conversation_id` já cai no
`idx_msg_conv_time` e sobram poucas centenas de linhas por conversa; `ILIKE`
nelas é barato. GIN/pg_trgm só se a busca virar global.

### Web — `chat-panel.tsx`

- `useQuery` vira `useInfiniteQuery` com cursor `before`: rolar para cima carrega
  as anteriores. Isso sozinho remove o teto de 50 mensagens.
- Lupa no header abre o painel de busca, com data e trecho por resultado.
- Clicar no resultado carrega a janela `around`, rola até a mensagem e pisca o
  destaque — reaproveitando o scroll+highlight que o "Responder" já usa.
- Botão "voltar pro fim" sai da janela histórica.

### Cuidado com o socket

Hoje `message:new` dá append no fim do cache. Numa janela histórica isso seria
mentira visual. Regra: quando a janela carregada não contém a última mensagem, o
socket não appenda — mostra "nova mensagem ↓".

---

## Testes

**Fatia 1 (API):** o `where` montado inclui as três cláusulas de busca; o termo
com máscara de telefone casa o telefone em dígitos; termo com menos de 3 dígitos
não gera cláusula de telefone; etiqueta + busca preserva as duas restrições.

**Fatia 2 (API):** `before` devolve só anteriores à âncora; `around` centraliza a
âncora; `search` casa `text` e `caption` e respeita o isolamento por organização
e o escopo de canal.

**Fatia 2 (Web):** teste de unidade do reducer de janela — decide se o socket
appenda ou mostra "nova mensagem ↓".

## Ordem

Fatia 1 primeiro: é pequena, não depende da Fatia 2 e resolve o problema
relatado.
