# Cadência de Reengajamento de Entrada ("Não respondeu") — Design

**Data:** 2026-07-14
**Autor:** Kleber (Orlando Fast Pass) + Claude
**Status:** Aprovado para plano de implementação
**Fatia:** Fatia 2 do Fluxo Comercial OFP (roadmap da [[cadencia-negociacao-feature]])

---

## 1. Problema

A **Cadência de Negociação** (Fatia 1, LIVE) recupera leads **pós-proposta** (etapa PROPOSTA ENVIADA). Mas há um vazamento **antes disso**: leads que a Aline (SDR IA) atende no 1º contato e que **param de responder antes de chegar num humano** — seja logo após a 1ª mensagem da Aline, seja abandonando no meio da qualificação. Hoje esses leads simplesmente esfriam sem nenhum toque de reengajamento e sem sinalização no funil.

## 2. Objetivo

Criar uma **segunda cadência**, irmã da de Negociação, que reengaja automaticamente leads silenciosos **enquanto ainda estão nas mãos da Aline** (pré-humano), com 3 toques temporizados. Se o lead volta a responder, a Aline reassume. Se esgota sem resposta, o card é marcado numa nova etapa **"Não respondeu"**.

### Não-objetivos (YAGNI)
- Não classifica resposta em Sim/Não (isso é da cadência de Negociação). Aqui, **qualquer resposta = a Aline reassume**.
- Não atua sobre leads que já chegaram num humano (assinados/em fila "Esperando") — esses são responsabilidade do atendente.
- Não substitui a aba "Inatividade" (reengajamento genérico por dias de silêncio).

## 3. Cenários cobertos (caso "C")

1. **Silêncio no 1º contato:** Aline manda a 1ª mensagem, o cliente nunca responde.
2. **Abandono na qualificação:** Aline faz uma pergunta no meio da ficha, o cliente para de responder.

Ambos reduzem ao mesmo sinal: **a Aline enviou uma mensagem, a conversa ficou aguardando o cliente, e o lead está em etapa pré-humana.**

## 4. Arquitetura

Reusa o módulo `src/modules/cadences` + `src/modules/scheduling` já existente. **O que muda é só o gatilho de inscrição.** Toda a mecânica de agendamento de toques (`ScheduledMessage`), dispatch, auto-cancel no reply, templates HSM por passo e envio via `MessagesService` é reaproveitada.

### 4.1 Novo tipo de gatilho

Adicionar valor `NO_REPLY` ao enum `CadenceTrigger` (hoje `STAGE_ENTER | MANUAL | BOTH`):

```prisma
enum CadenceTrigger {
  STAGE_ENTER
  MANUAL
  BOTH
  NO_REPLY   // novo: reengajamento de entrada
}
```

Uma cadência `NO_REPLY` NÃO usa `stageId` como gatilho de entrada; em vez disso usa novos campos de escopo (ver 4.4). O `lostStageId` da cadência de Negociação é reaproveitado como **etapa destino** ao esgotar — aqui apontando para a nova etapa **"Não respondeu"** (mantemos o mesmo campo `lostStageId` por economia de schema; semanticamente é "etapa ao esgotar").

### 4.2 Gatilho de inscrição (a parte nova)

Hook novo no **`src/modules/messaging/pipeline/outbound-message.processor.ts`**: após persistir/enviar uma mensagem **do agente IA (Aline)** numa conversa, chamar um novo método análogo ao `maybeStartForStage`:

```
CadenceRunner.maybeStartForNoReply(conversationId, orgId)
```

Que inscreve **somente se todas as condições valerem**:
- Existe uma cadência `NO_REPLY` `enabled=true` na org.
- A mensagem é **outbound do agente IA** (não de humano, não do sistema/cadência — evita auto-loop de toque disparando toque).
- A conversa está **aguardando o cliente** (última mensagem é da Aline; sem resposta pendente do lead).
- O lead está **pré-humano**: `conversation.awaitingHumanReply = false` **e** `conversation.assignedToId = null` (ou não em canal/fila humana). *[o predicado exato de "pré-humano" será fixado no plano após inspeção do FSM de conversa]*
- Opcionalmente: o card está numa das **etapas monitoradas** (ver 4.4). Se a lista estiver vazia, aplica a qualquer etapa pré-humana.
- Guarda de idempotência já existente (`findActiveByConversation`) impede dupla inscrição.
- Guarda de opt-out já existente (`optOutTagId`) impede inscrever descadastrados.

**Reset natural:** cada resposta do cliente cancela a inscrição ativa (mecanismo `handleInbound` já existente). A próxima mensagem da Aline abre uma nova inscrição → cobre o abandono no meio da qualificação sem código extra de "reset".

### 4.3 Os 3 toques

`CadenceStep[]` com `delayMinutes`:

| Toque | delayMinutes | Sugestão de texto padrão |
|-------|--------------|--------------------------|
| 1 | 180 (3h) | "Oi {nome}! 😊 Vi que ficou por aqui. Quer que eu continue montando seu roteiro pra Orlando?" |
| 2 | 1440 (24h) | "{nome}, ainda dá tempo de garantir os melhores preços pra sua viagem. Posso te ajudar a fechar os detalhes? 🏰" |
| 3 | 4320 (3d) | "{nome}, vou encerrar seu atendimento por aqui por ora 💜 Mas é só me chamar quando quiser retomar seu orçamento pra Orlando!" |

- **Texto fixo editável** por passo (`content`), com `{nome}` substituído.
- Cada passo pode opcionalmente sair via **template HSM** (`contentType`, template ref) — reusa o sistema de Templates para o canal oficial fora da janela 24h.
- Defaults em `cadences.constants.ts` (ex.: `DEFAULT_NO_REPLY_STEPS`).

### 4.4 Escopo de etapas monitoradas

Novo campo (JSON/relação simples) na `Cadence` para `NO_REPLY`: `watchedStageIds String[]` (ou tabela pivô). Guarda as etapas pré-humanas que devem ser monitoradas (default sugerido: "Distribuir" + "Coletando Informação"). Vazio = qualquer etapa pré-humana. Mantém o desenho flexível sem hardcode de nomes.

## 5. Transições

| Evento | Ação |
|--------|------|
| Cliente responde (qualquer momento) | Para a cadência (`handleInbound`), cancela toques futuros, **Aline reassume autônoma**. Card permanece na etapa atual (naturalmente avança pra "Distribuir" quando a Aline faz o handoff). |
| Cliente responde "descadastrar"/"parar" (opt-out) | Para tudo, marca `optOutTagId`, não envia mais nada. |
| Esgotou os 3 toques sem resposta | Move o card para a etapa **"Não respondeu"** (`lostStageId` da cadência). Encerra enrollment (`endReason = "no_reply_exhausted"`). |

## 6. Nova etapa no pipeline

Criar a etapa **"Não respondeu"** no fim do pipeline "Vendas OFP", **depois de "Perdido"**:

```
Distribuir → Coletando Informação → Proposta Enviada → Ganho → Perdido → Não respondeu
```

Criada via seed/migração de dados **idempotente** (não hardcodar id; achar o pipeline "Vendas OFP" da org e anexar a etapa se ainda não existir). A cadência aponta seu `lostStageId` pra essa etapa via a página de config.

## 7. Página de configuração (nova, espelhando "Cadências")

Nova aba/página em Settings — **"Reengajamento de Entrada"** — modelada na tela de Cadências (`src/features/cadences` no web):
- Toggle **Ativa** (vem desligada).
- Seleção de **pipeline** + **etapas monitoradas** (multi-select, default Distribuir+Coletando) + **etapa destino "Não respondeu"** + **tag de opt-out**.
- Os **3 textos** editáveis (pré-preenchidos com os defaults) + por passo: toggle "enviar via template HSM" e seleção do template.
- Reusa o CRUD `/cadences` existente (a cadência criada tem `trigger = NO_REPLY`).
- Selo no header da conversa: "🔁 Em reengajamento" (análogo ao "🔁 Em cadência").

## 8. Isolamento por tenant

Tudo escopado por `organizationId` (sem RLS — é Prisma+Postgres no NestJS, multitenant por coluna; ver skill `ofp-schema`). Toda query nova filtra `organizationId`; o guard de posse do `CadenceRunner.start` já cobre o caminho manual.

## 9. Testes

- **Unit (runner):** `maybeStartForNoReply` inscreve só quando (agente IA + aguardando cliente + pré-humano + cadência NO_REPLY enabled); não inscreve se humano/assinado, se já há enrollment ativo, se opt-out, se disabled.
- **Unit (inbound):** resposta do cliente cancela a cadência NO_REPLY; opt-out marca tag.
- **Unit (exhaust):** após o 3º toque sem resposta, move card pra "Não respondeu" e encerra com `end_reason`.
- **Guard de auto-loop:** um toque da cadência (mensagem do sistema) NÃO dispara nova inscrição.
- **Cross-tenant:** cadência de org A não inscreve conversa de org B.

## 10. Deploy

- **Base do PR:** `feat/conversation-tabs` (branch viva do VPS — ver [[vps-deploy-live-stack]] e [[deploy-via-pr-nao-push-direto]]). NÃO empurrar direto na viva.
- Migração aditiva: enum `NO_REPLY` + campo `watchedStageIds` + seed idempotente da etapa "Não respondeu".
- Ordem de deploy no VPS: `git fetch/reset` ANTES de `docker compose up -d --build`, depois `migrate deploy` (ver pegadinha em [[cadencia-negociacao-feature]]).
- Vem **desligada**; ativar pela nova página após E2E.

## 11. Riscos / pontos a confirmar no plano

1. **Predicado exato de "pré-humano"** — confirmar no FSM de conversa quais campos definem "não chegou no humano" (`awaitingHumanReply`, `assignedToId`, canal/fila). Fixar no plano.
2. **Identificar "mensagem outbound do agente IA"** no `outbound-message.processor.ts` — distinguir Aline de humano e de mensagens do próprio sistema/cadência (senão toque dispara toque).
3. **`lostStageId` reutilizado como "etapa ao esgotar"** — decidir se mantém o nome do campo (economia) ou adiciona `exhaustStageId` semântico. Recomendação: manter `lostStageId`, documentar.
4. **`watchedStageIds`**: array escalar no Postgres via Prisma vs tabela pivô — decidir no plano (array escalar é suficiente).
