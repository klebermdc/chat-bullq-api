# Transferência de cliente + ADM/Owner não rouba atendimento

**Data:** 2026-07-15
**Status:** Aprovado, em implementação

## Problema

Hoje, quando **qualquer** atendente responde numa conversa, a auto-atribuição
reescreve `assignedToId` para o remetente ("whoever replies owns the
conversation" — [messages.service.ts:167](../../src/modules/messaging/messages/messages.service.ts)).
Isso significa que quando um ADM/Owner entra numa conversa que já tem um
vendedor de direito e manda uma mensagem, ele **rouba** o cliente do vendedor.
Para atendentes com role AGENT o card some da caixa (escopo por
`assignedToId`), então na prática o vendedor perde o cliente.

## Objetivos

1. **ADM/Owner não rouba** conversa que já tem dono. O cliente permanece com o
   agente de direito quando um ADM/Owner apenas responde.
2. **Botão de Transferência** dedicado, explícito, para mover o cliente de um
   atendente para outro de forma intencional (com registro no histórico).

## Decisões (confirmadas com o usuário)

- Conversa **sem dono** (`assignedToId = null`): ADM/Owner que responde **assume**.
  Só bloqueia o roubo quando já existe um agente atribuído.
- Botão de Transferir: **dedicado + modal** (busca de atendente + motivo
  opcional), grava **mensagem SYSTEM** no chat registrando a transferência.
- **Quem pode transferir:** todos (sem restrição de papel) — comportamento atual.
- Local do botão: **header da conversa**.

## Design

### Parte 1 — Backend: auto-assign ciente de role

Em `messages.service.send()`:

```ts
const isPrivileged = role === OrgRole.OWNER || role === OrgRole.ADMIN;
const hasOwner = conversation.assignedToId != null;
const shouldAutoAssign =
  conversation.assignedToId !== senderId && !(isPrivileged && hasOwner);
```

Tabela:

| Quem responde | Estado | Resultado |
|---|---|---|
| AGENT | qualquer | assume (inalterado) |
| ADM/Owner | tem dono | fica com o dono (novo) |
| ADM/Owner | sem dono | ADM assume |
| ADM/Owner | já é dele | no-op |

`role` é passado do controller (`@CurrentUserRole()`) para `service.send(...)`
como parâmetro opcional no fim (default = fail-closed, tratado como AGENT).
**Nada mais muda**: IA continua pausando quando humano responde,
`awaitingHumanReply=false`, marca lido, cancela watchdog.

### Parte 2 — Backend: endpoint de transferência

`POST /conversations/:id/transfer` — body `{ toUserId: string; reason?: string }`.

- Valida acesso ao canal (findOne com `access`).
- Chama `fsm.assign(id, toUserId, actorId)` (já grava audit log `ASSIGNED` +
  dispara automação `CONVERSATION_ASSIGNED`).
- Cria mensagem SYSTEM direto no banco (não vai pra fila de entrega, então
  **não é enviada ao WhatsApp**):
  `{ direction: OUTBOUND, type: SYSTEM, status: SENT, senderId: actorId,
     sentAt: now, content: { text, transfer: { fromId, toId, reason } } }`.
- Emite `message:new` (realtime) para aparecer no thread na hora.

### Parte 3 — Frontend: botão Transferir + modal

- Botão "Transferir" no [conversation-header.tsx](../../../chat-bullq-web/src/features/inbox/components/conversation-header.tsx),
  ao lado do AssignmentPopover (que é mantido).
- Modal: busca de atendente (reusa `membersService.list`) + campo "Motivo
  (opcional)" + confirmar → `POST /conversations/:id/transfer`.

### Parte 4 — Frontend: renderizar mensagem SYSTEM

- Em [chat-panel.tsx](../../../chat-bullq-web/src/features/inbox/components/chat-panel.tsx):
  branch `type === 'SYSTEM'` → pílula cinza centralizada no thread (não é
  balão de cliente nem de atendente). Escopo extra porque hoje não existe render de SYSTEM.

## Testes

- Unit `messages.service`: 3 casos de auto-assign por role.
- Unit/integração do endpoint transfer: reatribui + cria SYSTEM msg.
