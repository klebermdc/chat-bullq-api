# Horário de funcionamento geral + comportamento da Aline fora do horário

**Data:** 2026-07-26
**Status:** Spec aprovado (aguardando review do usuário)
**Branch:** `feat/aline-horario-funcionamento` (base `feat/conversation-tabs`).
Deploy via PR — não push direto. Fazer `git fetch fork` antes de concluir "falta X".

## Problema

Quando a agência está **fechada** (fora do horário configurado) e nenhum humano
está atendendo, o lead recebe **silêncio puro**. Hoje a Aline é **calada** pelo
portão de horário e nenhuma mensagem é enviada.

O usuário quer o cenário **A**: a Aline **continua atendendo 24/7**, qualifica o
lead naquele momento, e **avisa o horário de funcionamento geral** + quando um
humano volta a responder.

## Estado atual (levantado no código)

1. **Editor manual de dias/horários — JÁ EXISTE e está completo.**
   `Configurações → IA`, seção "Horário de atendimento"
   (`chat-bullq-web/src/app/(dashboard)/settings/ai/page.tsx:257-363`):
   liga/desliga cada dia, janelas `[de, até]` por dia (add/remove várias),
   timezone, e toggle "Atendimento 24/7". Salva em `aiBusinessHours`/`aiTimezone`.
   **Nada novo a construir aqui.**

2. **Portão da IA** — `chat-bullq-api/src/modules/ai-agents/router/agent-router.service.ts:246`:
   fora de `aiBusinessHours` → `{ handle:false, reason:'outside-business-hours' }`
   → Aline fica **muda**. `aiBusinessHours == null` = 24/7 (default).

3. **Campo-fantasma `aiOutOfHoursMessage`** — existe em schema
   (`chat-bullq-api/prisma/schema.prisma:146`), DTO e tela ("Mensagem fora de
   horário (opcional)"), o usuário digita e **salva**, mas **NENHUMA linha do
   backend lê ou envia** esse campo. Promessa quebrada na UI.

4. **Dica de horário no prompt está errada/chumbada** —
   `chat-bullq-api/src/modules/ai-agents/memory/long-term/context-enrichment.service.ts:95`
   usa **9h–19h Seg–Sex fixo** (ignora `aiBusinessHours`) e só produz
   "dentro/fora do horário comercial"
   (`.../prompts/layers/context.layer.ts:141`), nunca diz **qual** é o horário
   nem **quando volta**.

## Decisão de produto

Unificar tudo num **seletor único** na tela de config, substituindo o par
confuso (portão silencioso + campo-fantasma):

> **"Fora do horário, a Aline:"**
> - **Não responde** (`SILENT`) — comportamento atual, silêncio.
> - **Envia uma mensagem fixa** (`MESSAGE`) — finalmente **liga** o campo
>   `aiOutOfHoursMessage`; envia o texto 1x por período fechado, Aline segue muda.
> - **Continua atendendo e avisa o horário** (`ATTEND`) — **cenário A / default
>   para a OFP**: pula o portão, Aline roda 24/7, qualifica e anuncia o horário +
>   próximo retorno humano.

Quando "Atendimento 24/7" está ligado (`aiBusinessHours == null`) não existe
"fora do horário" → o seletor fica oculto/irrelevante.

Multi-tenant: default `SILENT` preserva o comportamento atual de todo tenant.

### Copy aprovado
Rótulos: **Não responde** / **Envia uma mensagem fixa** / **Continua atendendo e
avisa o horário**.

Instrução da Aline no modo `ATTEND` (vai pra camada de comportamento — texto
editável por org depois, com default no código):
> *"Fora do horário de atendimento, continue qualificando o lead normalmente. Em
> algum momento natural, avise que o atendimento humano é {horário} e que alguém
> da equipe retorna {próximo_horário}. Nunca invente horários — use só os
> fornecidos."*

`{horário}` = `hoursSummary`; `{próximo_horário}` = `nextOpenLabel`, ambos
calculados de `aiBusinessHours`.

## Modelo de dados (aditivo — segue ofp-schema; sem RLS, tenant por `organizationId`)

- **`Organization.aiOffHoursMode String @default("SILENT")`** — valores
  `SILENT | MESSAGE | ATTEND`. **String, não enum Postgres** — evita a pegadinha
  de "ADD VALUE + uso na mesma migração quebra `migrate deploy`"
  (ver `fix-cadence-revive-migration-quebrada`).
- **Reusa** `aiOutOfHoursMessage String?` (modo `MESSAGE`).
- **Reusa** `aiBusinessHours Json?` + `aiTimezone` como fonte única do horário.
- **`Conversation.aiOffHoursMessageAt DateTime?`** — dedup do modo `MESSAGE`
  (1 envio por período fechado). Coluna **própria**, para não colidir com
  `Conversation.offHoursNoticeAt` do aviso por-atendente (feature já viva).

Migração aditiva, sem backfill.

## Arquitetura

### Util compartilhado de horário
Reusar o **`business-hours.util.ts`** que já existe nesta base
(`feat/conversation-tabs`, do `horario-atendente-fora-de-horario-feature`):
expõe `isWithinHours` / `nextOpenAt` / `previousCloseAt` / `formatReturn`.
Se algum helper faltar, estender ali (não criar util paralelo). Todos leem
`aiBusinessHours` + `aiTimezone`.

Limitação conhecida (LOW, herdada): janela que vira meia-noite (`end < start`,
ex. 22h–02h) é tratada como sempre-fechada.

### Modo ATTEND (cenário A)
1. **Portão** — `agent-router.service.ts:246`:
   ```
   if (!isWithinBusinessHours(org)) {
     if (org.aiOffHoursMode !== 'ATTEND') {
       return { handle: false, reason: 'outside-business-hours' };
     }
     // ATTEND → cai fora do if, Aline atende e vai anunciar o horário
   }
   ```
2. **Enrichment** — `context-enrichment.service.ts`: carregar `aiBusinessHours`/
   `aiTimezone` da org (hoje não carrega a org) e trocar o `isBusinessHours()`
   chumbado pelo util. Estender `EnrichedContext.time` com `isOpen`,
   `hoursSummary` (frase do horário) e `nextOpenLabel` (ex. "amanhã às 9h").
3. **Prompt** — `context.layer.ts`: fechado → renderizar horário real + "um humano
   retorna em `<nextOpenLabel>`". Adicionar a instrução do copy acima na camada de
   comportamento da Aline (ver `ofp-sdr-aline`).

### Modo MESSAGE (liga o campo-fantasma)
Quando o router recusa com `reason:'outside-business-hours'` **e**
`aiOffHoursMode === 'MESSAGE'` **e** `aiOutOfHoursMessage` não-vazio **e** ainda
não enviado neste período fechado (`aiOffHoursMessageAt` null ou
`< previousCloseAt`):
- Enviar o texto 1x via `messages.send(...)` com **`{ automated: true }`**
  (flag que pula os efeitos de "humano respondeu" — mesma pegadinha do aviso
  por-atendente: sem tirar de Esperando, sem cancelar watchdog, sem marcar lido).
- Gravar `aiOffHoursMessageAt`.
- Hook: serviço fire-and-forget no `inbound-message.processor.ts`, ao lado de onde
  o aviso por-atendente já é chamado (bloco `!isEcho && INBOUND`).

### UI (chat-bullq-web)
- Substituir a seção "Mensagem fora de horário" solta pelo **seletor**
  `aiOffHoursMode` logo abaixo do editor de horários (visível só quando 24/7 OFF).
- `MESSAGE` selecionado → revela a `<textarea>` do `aiOutOfHoursMessage`.
- `ATTEND` (default OFP) → sem campo extra; helper "Aline atende 24/7 e avisa o
  horário quando a equipe está fora".
- Ligar `aiOffHoursMode` no `ai-settings.service.ts` (load/save) + DTO da API.

## Considerações

- **Canal oficial (Meta):** tanto o TEXT da Aline (ATTEND) quanto a msg fixa
  (MESSAGE) são resposta a inbound recente → **dentro da janela 24h** → TEXT
  livre, sem HSM.
- **Custo:** Aline em ATTEND roda à noite → mais chamadas LLM. O
  `aiMonthlyTokenCap` continua valendo como teto (portão separado, intacto).
- **Deploy:** branch `feat/aline-horario-funcionamento` → PR para
  `feat/conversation-tabs`. Rebuild api+web na VPS, aplicar migração.
  `git fetch fork` antes de assumir o que existe/falta.

## Fora de escopo (YAGNI)

- Horário por-atendente (já existe: `horario-atendente-fora-de-horario-feature`).
- TZ por atendente (usa `aiTimezone` da org).
- Reescrever o editor de dias/horários (já pronto).
