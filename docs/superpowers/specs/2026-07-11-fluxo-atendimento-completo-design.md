# Fluxo de Atendimento Completo (CRM WhatsApp OFP) — Design

**Data:** 2026-07-11
**Branch viva de deploy:** `feat/conversation-tabs` (fork `klebermdc`)
**Disciplina:** cada fatia = 1 PR próprio na `conversation-tabs` (nunca push direto).

---

## Contexto

A maioria dos módulos do fluxo ponta-a-ponta já existe, mas espalhados e sem as
transições automáticas que os conectam. Este design conecta os blocos em um
fluxo único e coeso, entregue em **5 fatias deployáveis em ordem**.

### Check do estado real (contra `fork/feat/conversation-tabs`)

| Etapa | Estado | Realidade |
|---|---|---|
| 1 — Entrada + identificação (UTM/CTWA→card) | Faltando na viva | Captura CTWA/UTM e criação de card só em worktrees não mergeados. Inbound cria só `Conversation`. |
| 2 — Triagem SDR IA (Aline) | Infra pronta, glue faltando | `voiceProfile='warm'` e agente de captação na branch. Falta gravar resumo no card + Painel + liberar distribuição. |
| 3 — Distribuição → "Coletando informações" | Parcial | Round-robin (`RouterService`) existe mas ninguém chama. Fluxo vivo é por tag (seed RN-01/RN-04). Avanço é tag, não etapa de pipeline. |
| 4 — Proposta pelo carrinho (✈️) | Quase — falta glue | Botão ✈️, render headless (delay 1s), extração LLM, entidade `Proposal` estruturada: na branch. Falta mover card p/ "Proposta enviada" + iniciar cadência. |
| 5 — Fechou pedido + correlação HUB | Faltando (só fundação) | HUB ingerido/espelhado (`sales-reports`). Falta botão, nº pedido no card, correlação, "ganho", fila de reconciliação. |
| 6 — Pedido enviado (tag + etapa final) | Faltando | Sem botão, sem tag "ingressos enviados", sem move p/ etapa final. |

### Decisões de escopo (tomadas com o usuário, 2026-07-11)

- **Etapa 1 (CTWA):** deferida. Mantém a trava do meta-capi até migrar o número
  oficial. A estrutura do card fica pronta para receber UTM/CTWA e a criação
  automática de card no inbound entra como pré-requisito da Fatia 3, mas a
  **captura de anúncio fica desligada** até liberação.
- **Modelo do card:** manter o híbrido atual (tags cedo, etapas de pipeline de
  "Proposta enviada" em diante). Não refatorar para pipeline puro. O que importa
  é que as **transições disparem automaticamente**.
- **Sequência:** fatias deployáveis em ordem **4-glue → 6 → 3 → 2 → 5**.

### Mecânica confirmada no código

- Cadência dispara por **entrada em etapa de pipeline**: `pipelines.service.moveCard()`
  chama `cadenceRunner.maybeStartForStage(conversationId, cardId, toStageId, org)`
  quando o card muda de etapa **e tem `conversationId`** (fire-and-forget).
  Ref: `src/modules/pipelines/pipelines.service.ts:491-504`.
- `Card` tem `conversationId`/`contactId` (nullable). `createCard` faz upsert por
  conversa (rejeita duplicata) mas **não** dispara cadência.
  Ref: `src/modules/pipelines/pipelines.service.ts:232-330`.
- `proposals.service.create()` recebe `conversationId`, carrega a conversa (com
  `contactId`), renderiza/extrai/salva `Proposal`, envia a mensagem — e **não
  toca em pipeline/cadência**. Ref: `src/modules/proposals/proposals.service.ts:30-96`.

---

## Fatia 1 — Etapa 4 glue: "Proposta enviada" + cadência (ESTA SPEC)

### Objetivo

Quando a proposta é enviada com sucesso pelo ✈️, o card da conversa vai
automaticamente para a etapa **"Proposta enviada"**, o que dispara a cadência
existente. Sem mudança de schema. Sem mudança de UI.

### Comportamento

1. `proposals.service.create()` roda como hoje: extrai URL → render (delay 1s) →
   extração LLM → salva `Proposal` estruturado → **envia a proposta ao cliente**.
2. **Dispara-direto:** só **depois do envio bem-sucedido** executa o passo novo.
   Se o envio ao cliente falhar, nada de pipeline/cadência acontece (o fluxo já
   lança exceção antes).
3. Passo novo — mover para "Proposta enviada":
   - Resolve o **pipeline de vendas** e a **etapa "Proposta enviada"** por
     convenção + config (ver abaixo).
   - Encontra o card da conversa: `card.findFirst({ pipelineId, conversationId })`.
   - Se **não existe** card → cria um (deriva título/contato da conversa) já
     entrando na etapa "Proposta enviada" **e** dispara a cadência explicitamente
     (porque `createCard` não dispara sozinho).
   - Se **existe** e **não está** em "Proposta enviada" → move via `moveCard`
     (que já dispara a cadência).
   - Se **existe** e **já está** em "Proposta enviada" → **no-op** (não re-move,
     não reinicia cadência). Idempotência.
4. A extração já salva `Proposal` estruturado (link, adultos, crianças, datas,
   parques, valor) — isso permanece intacto e é a base dos relatórios.

### Configuração (resolução de pipeline/etapa)

- Env/AppConfig com defaults:
  - `SALES_PIPELINE_NAME` default `"Vendas OFP"`
  - `PROPOSAL_SENT_STAGE_NAME` default `"Proposta enviada"`
- Resolução: pipeline da org cujo `name` casa (case-insensitive, trim) com
  `SALES_PIPELINE_NAME`; nele, a etapa cujo `name` casa com `PROPOSAL_SENT_STAGE_NAME`.
- **Degradação graciosa:** se o pipeline ou a etapa não forem encontrados, faz
  **log de aviso e segue** — a proposta já foi enviada e salva; o atendente não
  pode ver o envio falhar por causa da automação.

### Tratamento de erro

- O passo de pipeline/cadência roda em `try/catch` **isolado** do envio.
- Falha no `findOrCreate`/`moveCard`/cadência → loga e retorna sucesso ao
  atendente (a proposta já foi entregue e persistida).
- Nunca reverter um envio por falha de automação.

### Acoplamento

- `ProposalsModule` passa a importar `PipelinesModule` (que já traz `CadencesModule`).
- Uma função nova em `PipelinesService`, ex.: `enterStageForConversation(
  conversationId, organizationId, { pipelineName, stageName })`, encapsula
  resolver→findOrCreate→move→(cadência), para manter `proposals.service` fino e
  a lógica de pipeline dentro do módulo de pipeline.
- Sem migração de banco.

### Testes (TDD)

Unit em `proposals.service.spec` e `pipelines.service.spec`:

1. Envio OK → card da conversa move p/ "Proposta enviada" e cadência é chamada.
2. Card já em "Proposta enviada" → **não** re-move, cadência **não** é chamada de novo.
3. Card não existe → cria na etapa e dispara cadência uma vez.
4. Etapa/pipeline inexistente → envio ainda OK, **sem throw**, com log.
5. `moveCard`/cadência lança → não propaga; `create()` retorna a proposta.
6. Envio ao cliente falha → passo de pipeline **não** roda.

### Fora de escopo desta fatia

- Botão/UI (já existe o ✈️).
- Qualquer mudança nas etapas 1/2/3/5/6.

---

## Roadmap das próximas fatias (resumo — cada uma terá sua própria spec)

- **Fatia 2 — Etapa 6 (Pedido enviado):** terceiro botão no compositor → aplica
  tag "ingressos enviados" + move card p/ etapa final "Pedido enviado".
- **Fatia 3 — Etapa 3 (Distribuição):** criar card automaticamente no inbound
  (campos UTM/CTWA prontos, captura desligada) + atribuição avança card/tag p/
  "Coletando informações" de forma consistente.
- **Fatia 4 — Etapa 2 (SDR triagem):** Aline grava resumo nas observações do
  card + empurra pro Painel Inteligente + libera distribuição.
- **Fatia 5 — Etapa 5 (Fechou pedido + HUB):** botão "Fechou o pedido" (nº do
  pedido) + agente de correlação HUB↔card (marca ganho) + fila de reconciliação
  (heurísticas automáticas + UI de vínculo manual).
