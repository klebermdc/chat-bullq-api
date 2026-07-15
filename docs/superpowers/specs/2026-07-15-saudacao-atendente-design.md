# Saudação automática do atendente

**Data:** 2026-07-15
**Status:** Aprovado (brainstorming) — pronto para plano de implementação

## Problema

Quando um lead é distribuído/atribuído a um atendente e o atendente assume o
atendimento, o cliente não recebe nenhum sinal de que trocou de interlocutor
(saiu da IA "Aline" ou de outro atendente). Queremos que, no momento em que o
atendente efetivamente assume, o sistema **envie sozinho uma mensagem de
apresentação ao cliente no WhatsApp**, do tipo:

> "Oi! Sou o {atendente} e vou continuar seu atendimento por aqui 😊"

## Decisões do brainstorming

- **Template configurável por org** (não fixo no código), com placeholder
  `{atendente}` substituído pelo **1º nome** do atendente.
- **3 gatilhos**: (1) "Iniciar atendimento" (aprovar handoff distribuído),
  (2) transferência entre atendentes, (3) atribuição manual direta.
- Nome exibido: **só o 1º nome** (`name.split(/\s+/)[0]`).
- `enabled` nasce **ligado** (`default true`) — é o comportamento pedido e é
  low-risk porque só dispara em ação humana explícita.
- **Grupos não recebem** saudação.

## Descoberta técnica crítica

A transferência atual (`ConversationsService.transfer`,
`conversations.service.ts:513`) cria apenas uma mensagem **SYSTEM**, que **NÃO
é entregue ao cliente no WhatsApp** (não passa pela fila de envio). A saudação
precisa ser uma mensagem **TEXT real**, então usa o caminho de envio de
verdade: `MessagesService.send(...)`, que enfileira a entrega pelo adapter do
canal (`outbound-messages`) e aparece no thread como mensagem enviada pelo
atendente.

## Arquitetura

### 1. Storage — `AttendantGreetingSettings` (novo model, espelha `InactivitySettings`)

```prisma
model AttendantGreetingSettings {
  organizationId String   @id @map("organization_id")
  enabled        Boolean  @default(true)
  template       String   @default("Oi! Sou o {atendente} e vou continuar seu atendimento por aqui 😊") @db.Text
  updatedAt      DateTime @updatedAt @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@map("attendant_greeting_settings")
}
```

Relação inversa em `Organization` (como `inactivitySettings`).

### 2. Serviço central — `AttendantGreetingService`

Método único `greet(params)`, chamado pelos 3 gatilhos (DRY):

```
greet({ conversationId, attendantUserId, actorId, source })
```

Passos:
1. Carrega a conversa (org, canal, `isGroup`). Se `isGroup` → no-op.
2. Carrega settings da org (defaults se não existir). Se `enabled=false` → no-op.
3. Resolve `user.name` do atendente; `firstName = name.trim().split(/\s+/)[0]`
   (fallback `"atendente"` se vazio).
4. Renderiza o template: substitui `{atendente}` por `firstName`.
5. Envia via `MessagesService.send({ conversationId, type: 'TEXT',
   content: { text } }, attendantUserId, organizationId, 'ALL')`.
6. **Best-effort**: todo o passo 5 vai em `try/catch` — se falhar (ex: janela
   de 24h fechada, canal indisponível), **loga warn e engole** o erro. Nunca
   propaga exceção para o chamador (a atribuição/transferência não pode quebrar
   por causa da saudação).

`source` (`'HANDOFF_APPROVE' | 'TRANSFER' | 'MANUAL_ASSIGN'`) entra só no log,
para observabilidade.

### 3. Gatilhos (cada um com guarda anti-duplicação natural)

| # | Gatilho | Local | Guarda | Atendente (`attendantUserId`) |
|---|---|---|---|---|
| 1 | "Iniciar atendimento" (aprovar handoff) | `PendingActionService.approve()` | só se `action.conversationId && action.args?.distributedTo`; `approve` é one-shot (PENDING→APPROVED) | `userId` (quem clicou) |
| 2 | Transferência | `ConversationsService.transfer()` (após `fsm.assign` + SYSTEM msg) | já lança erro se destino == atual | `toUserId` |
| 3 | Atribuição manual | `ConversationsService.update()` | só quando `dto.assignedToId` está presente, é humano e **difere** do `assignedToId` atual (não nulo/unassign) | `dto.assignedToId` |

**Por que não há coluna de dedupe nova (YAGNI):**
- `approve` é one-shot — não re-dispara.
- `transfer` rejeita destino == atual.
- `update` só saúda quando o responsável **muda** — re-save vira no-op.
- Auto-assign da Aline e do router passam por `fsm.assign` (não por `update()`),
  então **não** disparam saudação. Só ação humana manual dispara.
- `distribute` seta `assignedToId` direto (não via `update()`), então não
  colide com o gatilho 3; a saudação do fluxo de handoff sai só no `approve`.

### 4. Frontend — configurações

Nova seção de configurações de atendimento (ou dentro de settings/ai):
- toggle **Enabled**;
- textarea do **template**, com dica: "Use `{atendente}` para inserir o 1º nome
  do atendente automaticamente."

Endpoints REST espelhando o padrão de `InactivitySettings`:
- `GET  /organizations/greeting-settings` → retorna settings (ou defaults).
- `PUT  /organizations/greeting-settings` → upsert `{ enabled, template }`.

RBAC: apenas gestor/owner edita (mesma regra das outras settings de org).

## Casos de borda

- **Grupo** → pula (passo 1).
- **Atendente sem nome** → `{atendente}` vira `"atendente"`.
- **Janela 24h fechada / canal off** → envio falha → logado, atendimento segue.
- **Settings inexistente** → usa defaults (`enabled=true`, template padrão).
- **Template sem `{atendente}`** → envia o texto literal (substituição no-op).

## Estratégia de testes

Unit (`AttendantGreetingService`):
- renderiza template substituindo `{atendente}` pelo 1º nome;
- extrai 1º nome de nome composto; fallback `"atendente"` sem nome;
- `enabled=false` → não chama `send`;
- `isGroup=true` → não chama `send`;
- falha de `send` é engolida (não relança).

Unit por gatilho:
- `approve()` chama `greet` só quando `args.distributedTo` presente;
- `transfer()` chama `greet` com `toUserId`;
- `update()` chama `greet` só quando `assignedToId` muda para humano diferente;
  não chama em re-save (mesmo assignee) nem em unassign (null).

## Fora de escopo (YAGNI)

- Personalização por atendente/canal (só por org).
- Suporte a template HSM/mídia na saudação (só TEXT free-form).
- Coluna de dedupe persistida (as guardas por gatilho bastam).
- Reenvio automático quando a janela de 24h reabre.
