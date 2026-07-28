# Fail-loud no channel-hub: mensagem de cliente nunca some em silêncio

**Data:** 2026-07-27
**Status:** Aprovado, em implementação
**Branch:** `feat/channel-hub-fail-loud` (base `fork/feat/conversation-tabs`)

## Problema

O `WebhookGatewayController` tem **três caminhos** onde uma mensagem de cliente
real é descartada devolvendo `200 OK` para o provedor, deixando apenas um
`logger.warn` que ninguém lê. O provedor considera entregue e nunca reenvia.

| Linha | Situação | Comportamento hoje |
|-------|----------|--------------------|
| [:66-68](../../src/modules/channel-hub/webhook-gateway.controller.ts) | Nenhum locator extraído | `warn` + `200` — **não grava** em `webhook_events` |
| [:88-96](../../src/modules/channel-hub/webhook-gateway.controller.ts) | Nenhum canal casou | grava UNROUTED — **ninguém é avisado** |
| [:106-111](../../src/modules/channel-hub/webhook-gateway.controller.ts) | Assinatura inválida | `continue` — **sem auditoria, sem aviso** |

A causa-raiz do apagão do Comercial está em
[`channels.service.ts:403`](../../src/modules/channel-hub/channels/channels.service.ts):

```ts
async resolveByLocator(type, matches) {
  const candidates = await this.repository.findActiveByType(type);  // isActive: true
  return candidates.find((c) => matches(c)) ?? null;
}
```

Um canal **desativado** não entra em `candidates`, então `resolveByLocator`
devolve `null` — indistinguível de "canal que nunca existiu". O webhook cai no
caso 2, vira UNROUTED, e o inbound do Comercial inteiro evapora. A descoberta
só acontece quando um cliente reclama.

## Objetivos

1. **Nenhum descarte sem rastro.** Todo caminho de drop grava em `webhook_events`
   com o motivo explícito.
2. **Descarte que dá pra agir vira alerta.** Quando dá para identificar a
   organização, o OWNER é notificado dentro do app.
3. **Distinguir canal inativo de canal inexistente.** É a diferença entre
   "reative o canal" (1 clique) e "investigue a configuração" (1 hora).

**Não-objetivo:** mudar a regra de roteamento. Canal inativo continua **não**
processando a mensagem. A mudança é que ele passa a **gritar** em vez de sumir.

## Decisões (confirmadas com o usuário)

- Escopo é **só o fail-loud**. O trust layer já existe (`AiAgentRun` +
  `AiToolCall` + UI em `agent-runs-sidebar.tsx`) — nada a portar ali.
- Alerta via **`notifyOrgAgents({ roles: [OrgRole.OWNER] })`**, o mesmo mecanismo
  já usado no `checkPurchase` e no `watchdog-timer.processor`. Sem infra nova.
- **Sem migration:** `WebhookEvent.errorMessage` e o status `UNROUTED` já
  existem; `NotificationType.SYSTEM` também.

## Design

### Componente novo: `InboundDropReporter`

Arquivo único: `src/modules/channel-hub/inbound-drop-reporter.service.ts`.
Ponto de convergência de todo descarte.

```ts
export enum InboundDropReason {
  NO_LOCATORS = 'NO_LOCATORS',
  CHANNEL_INACTIVE = 'CHANNEL_INACTIVE',
  UNKNOWN_LOCATOR = 'UNKNOWN_LOCATOR',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
}

async reportDrop(params: {
  channelType: ChannelType;
  reason: InboundDropReason;
  payload: unknown;
  headers: Record<string, string>;
  channel?: { id: string; name: string; organizationId: string } | null;
}): Promise<void>
```

Três passos, nessa ordem:

1. **Persiste** em `webhook_events` — status `UNROUTED`, `channelId` quando
   conhecido, e `errorMessage` = `"{reason}: {contexto legível}"`.
2. **Throttle** — `SET NX EX` no Redis, chave
   `chdrop:{channelType}:{reason}:{channelId ?? 'unknown'}`, TTL **15 min**.
   Já existente → retorna sem alertar.
3. **Alerta** — `notifyOrgAgents({ organizationId, roles: [OrgRole.OWNER],
   type: SYSTEM, title, body, data: { channelId, reason } })`.

O reporter **nunca lança**. Toda falha interna (Redis fora, Prisma fora) é
capturada e logada. Um erro no relato de um descarte não pode derrubar o
webhook e transformar 1 mensagem perdida em todas as mensagens perdidas.

### Matriz de comportamento

| Motivo | Grava | Alerta OWNER | Por quê |
|--------|-------|--------------|---------|
| `NO_LOCATORS` | ✅ (novo) | ❌ | Sem canal → sem organização. Payload malformado é quase sempre ruído do provedor |
| `CHANNEL_INACTIVE` | ✅ (novo) | ✅ | **O apagão.** Canal existe, org é conhecida, conserto é 1 clique |
| `UNKNOWN_LOCATOR` | ✅ (já grava) | ❌ | Impossível saber a org — só auditoria |
| `INVALID_SIGNATURE` | ✅ (novo) | ✅ | Canal conhecido → org conhecida. Sinal de token trocado/rotacionado |

**Limite assumido:** em `NO_LOCATORS` e `UNKNOWN_LOCATOR` não existe
`organizationId` para quem notificar. Ficam persistidos e auditáveis, sem push.
Não há como cobrir isso sem inventar um dono para o webhook.

### Mudança em `resolveByLocator`

Passa a enxergar canais inativos e a devolver o motivo:

```ts
async resolveByLocator(type, matches): Promise<{
  channel: Channel;
  active: boolean;
} | null> {
  const candidates = await this.repository.findByTypeIncludingInactive(type);
  const found = candidates.find((c) => matches(c));
  return found ? { channel: found, active: found.isActive } : null;
}
```

Novo método no repositório, espelhando `findActiveByType` sem o filtro
`isActive` (mantendo `deletedAt: null` — canal deletado é inexistente de fato):

```ts
async findByTypeIncludingInactive(type: ChannelType) {
  return this.prisma.channel.findMany({ where: { type, deletedAt: null } });
}
```

O controller decide o desfecho:

- `null` → `UNKNOWN_LOCATOR`
- `{ active: false }` → `CHANNEL_INACTIVE`, **não** entra em `matchedChannels`
- `{ active: true }` → segue o fluxo normal

**Risco e contenção:** `resolveByLocator` muda de assinatura, mas o raio de
alcance é mínimo — `grep -rn "resolveByLocator" src` devolve exatamente **um**
consumidor, o `webhook-gateway.controller.ts:73` (verificado em 2026-07-27 na
base desta branch). Ainda assim, a mudança de tipo de retorno é detectada pelo
`tsc --noEmit`, então nenhum chamador pode ficar para trás em silêncio.

### Fluxo final do controller

```
extractLocators → vazio?                    → reportDrop(NO_LOCATORS) + 200
  ↓
resolveByLocator (inclui inativos)
  ├─ null                                    → reportDrop(UNKNOWN_LOCATOR)
  └─ active: false                           → reportDrop(CHANNEL_INACTIVE)
  ↓ (só canais ativos)
matchedChannels vazio?                       → 200 no_matching_channel
  ↓
validateWebhook → inválido?                  → reportDrop(INVALID_SIGNATURE) + continue
  ↓
record + parse + enqueue                     → 200 ok
```

Sempre `200` para o provedor: o contrato externo não muda, e devolver erro faria
o provedor reenviar em loop um payload que continuaria caindo no mesmo lugar.

**Nota de implementação — granularidade do relato.** Hoje o `recordUnrouted`
acontece **uma vez por payload**, depois do laço. No design novo o relato passa
a ser **uma vez por locator**, dentro do laço, porque é só ali que dá pra saber
se aquele locator específico era desconhecido ou apenas inativo (a WA Official
faz batch de vários locators no mesmo payload). Consequência aceita: um payload
com N locators ruins gera N linhas em `webhook_events`, em vez de 1. O throttle
do alerta é por canal+motivo, então isso **não** multiplica notificações.

Quando `matchedChannels` fica vazio, o controller apenas retorna
`200 no_matching_channel` **sem** relatar de novo — cada locator já foi relatado
individualmente. Relatar nos dois lugares duplicaria toda linha de auditoria.

## Testes

`inbound-drop-reporter.service.spec.ts`:
- grava em `webhook_events` com o motivo em `errorMessage`, um caso por reason
- alerta OWNER em `CHANNEL_INACTIVE` e `INVALID_SIGNATURE`
- **não** alerta em `NO_LOCATORS` e `UNKNOWN_LOCATOR` (sem org)
- segunda chamada com a mesma chave dentro do TTL não alerta (throttle)
- Redis indisponível → não lança, e ainda assim persiste

`webhook-gateway.controller.spec.ts` (novo, seguindo o padrão dos
`.spec.ts` já existentes no módulo):
- os 4 caminhos chamam `reportDrop` com o motivo certo
- canal inativo **não** é enfileirado
- canal ativo segue enfileirando normalmente (não-regressão)

## Fora de escopo (YAGNI)

Migration, valor novo de enum, cron de health-check, endpoint
`GET /channels/health`, detector de narração-sem-tool da Aline, e alerta por
WhatsApp (dependeria do próprio canal que pode estar quebrado).
