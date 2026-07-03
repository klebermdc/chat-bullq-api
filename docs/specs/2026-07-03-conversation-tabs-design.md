# Abas de atendimento (Esperando / Caixa de entrada / Finalizados)

Data: 2026-07-03

## Problema

A lista de conversas não segmenta o que **precisa de resposta** do que **já foi
respondido**. O atendente não tem uma fila clara do que atacar. Queremos 3 abas
acima da lista:

1. **Esperando** — cliente aguardando atendimento (ninguém humano respondeu ainda).
2. **Caixa de entrada** — já respondidos por um humano (aguardando o cliente).
3. **Finalizados** — encerrados manualmente.

## Regras de negócio (confirmadas com o usuário)

- Cliente manda mensagem → conversa vai para **Esperando**.
- **Vendedor humano** responde → vai para **Caixa de entrada**.
- Resposta do **chatbot/IA NÃO conta** — enquanto só o bot respondeu, continua em
  **Esperando** (o humano ainda precisa olhar).
- Vendedor clica **"Finalizar"** → **Finalizados** (ação manual).
- Cliente manda mensagem numa conversa finalizada → **reabre** e volta para
  **Esperando**.

## Abordagem

Não mexemos no enum `ConversationStatus` (PENDING/BOT/OPEN/WAITING/CLOSED), que a
FSM/bot/SLA já usam. Cuidado: o `WAITING` atual significa "esperando o cliente" —
o **oposto** da aba Esperando. Por isso as abas são uma *visão* dirigida por um
sinal novo e simples:

**`Conversation.awaitingHumanReply: boolean`** (aguardando resposta humana).

| Evento | Efeito no flag |
|---|---|
| Mensagem inbound genuína do cliente | `awaitingHumanReply = true` |
| Resposta do humano (via `MessagesService.send`) | `awaitingHumanReply = false` |
| Resposta do bot/IA (via `prisma.message.create` nas tools) | **não muda** |
| Echo de msg nossa que volta pelo webhook (OUTBOUND) | **não muda** |

Mapeamento das abas:

- **waiting**  = `status != CLOSED` **E** `awaitingHumanReply = true`
- **inbox**    = `status != CLOSED` **E** `awaitingHumanReply = false`
- **closed**   = `status = CLOSED`

O ciclo de reabrir já cai sozinho no lugar certo: uma conversa finalizada que o
cliente responde volta a `PENDING` (reabertura em 24h) **ou** vira conversa nova
(`PENDING`) — em ambos os casos não-fechada + `awaitingHumanReply=true` → aba
**Esperando**. Não precisamos alterar a janela de reabertura de 24h.

### Edge case documentado

Se um humano responder **direto pelo celular** (WhatsApp app, fora da nossa UI), a
mensagem chega como *echo* (OUTBOUND) e **não** limpa o flag — a conversa fica em
Esperando até uma resposta pela UI. Aceitável: a esmagadora maioria das respostas
passa pela UI, e não dá pra distinguir echo-de-humano de echo-de-bot no webhook.

## Mudanças

### Backend (`chat-bullq-api`)

1. **Schema + migration**: coluna `awaiting_human_reply BOOLEAN NOT NULL DEFAULT false`
   + índice `(organization_id, status, awaiting_human_reply)`. Backfill: `true`
   para conversas não-fechadas cuja última mensagem é INBOUND.
2. **Pipeline**:
   - `inbound-message.processor.ts`: no update da conversa dentro da TX, setar
     `awaitingHumanReply = true` quando `direction === INBOUND`.
   - `messages.service.ts` (`send`): setar `awaitingHumanReply = false` no update
     da conversa (caminho exclusivamente humano — `senderId` é um user).
   - Bot/IA não passam por esses pontos → flag intacto.
3. **API**:
   - `GET /conversations?tab=waiting|inbox|closed` — traduzido no service para
     `awaitingHumanReply` + `excludeClosed`/`status=[CLOSED]`.
   - `GET /conversations/tab-counts?channelId=` → `{ waiting, inbox, closed }`,
     respeitando RBAC de canal e escopo de atribuição (RN-05), `isArchived=false`.

### Frontend (`chat-bullq-web`)

- Segmented control com as 3 abas acima da lista (`conversation-list.tsx`), só no
  inbox padrão (fora de saved views). Ordem: Esperando, Caixa de entrada,
  Finalizados. Default: **Esperando**.
- `tab` entra no `queryKey`/`filterKey` e vira `params.tab`.
- Badges de contagem via query `['conversation-tab-counts']` (endpoint novo),
  invalidada nos mesmos eventos realtime (`message:new`, `conversation:updated`,
  reconnect).

## Fora de escopo (YAGNI)

- Não persistimos a aba selecionada nas preferências (v1 usa default Esperando).
- Não alteramos a janela de reabertura de 24h.
- Não mexemos no enum de status nem na FSM.
