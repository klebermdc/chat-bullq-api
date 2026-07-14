# Copiloto — Chat interno no app (spec de design)

**Data:** 2026-07-14
**Autor:** Kleber + Claude
**Status:** aprovado o design de UX (mock), pendente revisão da spec

## Objetivo

Uma aba **"Copiloto"** dentro do próprio OFP Chat (web) onde **OWNER e ADMIN** conversam em linguagem natural com o agente interno "Copiloto" (que já existe em prod) para consultar **vendas, clientes e funil**, usando as **7 skills já criadas**. Sem WhatsApp, sem canal externo, sem bot, sem telefone.

Resolve a fricção descoberta: usar o agente por um número de WhatsApp é confuso e frágil (qual número, token da Meta vence, cada um do seu celular). O chat no app remove tudo isso — todo mundo do time já tem login.

## Não-objetivos (YAGNI)

- **Não** é para atendente (papel AGENT) — ele nem vê a aba.
- **Não** é canal externo (Telegram/WhatsApp/Instagram).
- **Não** cria voucher/reserva (skill ainda pendente de endpoint).
- v1 é **texto apenas** (sem anexos/mídia/áudio).
- v1 **não persiste histórico no banco** (ver Histórico) — sem migração.

## O que já existe (reuso)

- Agente **"Copiloto"** (`category = 'copiloto-interno'`, id `cmrjy3wy800cnnm075l7oflp6`) com **7 skills** (`AiAgentSkill`) já em prod.
- `LlmService.complete({ messages, tools })` — resolve o modelo pela `AiProviderKey` da org e já faz **tool-calling** (retorna `toolCalls`). Reusar direto.
- Executores de skill: `HttpToolExecutorService` e `SqlToolExecutorService` (recebem `AiSkill`, `AiTool`, input, `ToolContext`).
- `stripThinkBlocks()` em `runner/text-guards.ts` (remove `<think>` do modelo de raciocínio).
- RBAC: enum `OrgRole` (OWNER/ADMIN/AGENT) + `RolesGuard` + `@Roles(...)`.

## Abordagem escolhida

**Módulo dedicado `copilot` no backend + página `/copiloto` no web.** Um endpoint **síncrono** roda um loop de ferramentas enxuto que **reusa** `LlmService` (modelo + tool-calling), os executores de skill e `stripThinkBlocks`. Escrevemos só a **orquestração** do loop.

**Descartado:** reusar o `AiAgentRunnerService` inteiro criando uma conversa+canal internos "falsos". Motivos: exigiria um novo `ChannelType`, um adaptador de envio no-op, poluiria a Inbox com uma conversa fantasma, e a resposta seria assíncrona (o runner é `void`). O caminho dedicado é mais limpo e devolve a resposta na hora.

**Risco mitigado:** as partes historicamente bugadas (resolução de modelo via provider key, vazamento de `<think>`, formato de tool-call) são **reusadas** de `LlmService`/`text-guards`, não reescritas.

## Backend — módulo `copilot`

### Endpoint
`POST /copilot/ask`
- Guards: `JwtAuthGuard`, `OrgGuard`, `RolesGuard` + `@Roles(OrgRole.OWNER, OrgRole.ADMIN)`.
- Body: `{ text: string (1..2000), history?: {role:'user'|'assistant', content:string}[] }`.
- Resposta: `{ reply: string }`.

### `CopilotService.ask(orgId, text, history)`
1. **Resolve o agente:** `aiAgent.findFirst({ where: { organizationId, category: 'copiloto-interno', isActive: true, deletedAt: null } })`. Se não achar → `BadRequestException('Copiloto ainda não está configurado nesta conta.')`.
2. **Monta mensagens:** system prompt do agente + `history` (últimas ~10 trocas, vindas do front) + a nova pergunta.
3. **Monta as tools:** carrega as skills do agente (`AiAgentSkill → AiSkill (+ AiTool)`), converte cada `AiSkill.parameters` na definição de tool que o `LlmService` espera (mesmo formato que o runner usa).
4. **Loop (máx. 5 iterações):** chama `LlmService.complete({ messages, tools })`.
   - Se vier `toolCalls`: para cada uma, acha a `AiSkill` pelo nome, despacha via `HttpToolExecutorService` (source HTTP) ou `SqlToolExecutorService` (source SQL), anexa o resultado como mensagem `tool` e repete.
   - Se **não** vier tool call: é a resposta final → sai do loop.
5. Aplica `stripThinkBlocks()` na resposta final e retorna `{ reply }`. Se estourar 5 iterações, devolve a última resposta textual (ou uma mensagem neutra).

### ToolContext no chat interno
As SQL skills usam só `ctx.organizationId`; as HTTP não usam `ctx`. Mas o tipo `ToolContext` exige também `conversationId/contactId/channelId/agentId/runId`. Como não há conversa real, preenchemos:
- `organizationId`: real (crítico — isola o tenant).
- `agentId`: id real do Copiloto.
- `conversationId/contactId/channelId/runId`: sentinela `copilot` (as skills atuais não leem esses campos). Documentar no código. Se uma skill futura precisar de contato/conversa, tratar naquele momento.

### Histórico (v1)
**Sem persistência no banco.** O front guarda as mensagens da sessão e envia as últimas ~10 em `history` a cada `ask`. Zero migração. Auditoria de "quem perguntou o quê" fica como **fast-follow** opcional (tabela `CopilotMessage`) se o dono quiser depois.

## Frontend — web

- Nova rota **`/copiloto`** (Next.js) + item **"Copiloto"** no menu lateral, com cadeado 🔒, **renderizado só se o papel do usuário ∈ {OWNER, ADMIN}** (o backend também barra — a UI não é a única defesa).
- **Componente de chat:** lista de mensagens (bolha do usuário / bolha do Copiloto), chips de sugestão, caixa de digitar. Ao enviar: bolha otimista do usuário + estado "digitando…" enquanto espera; `POST /copilot/ask` com `{ text, history }`; renderiza a resposta.
- **Estado vazio:** saudação + 3 sugestões (as perguntas comuns).
- Visual conforme o mock aprovado (paleta Ametista, coerente com o app).

## Erros

- Agente não configurado → 400 → UI: "O Copiloto ainda não está configurado."
- Erro numa skill (ex.: SQL/HTTP) → o loop não quebra; o modelo recebe o erro como resultado da tool e responde algo tipo "não consegui consultar isso agora". UI mostra a resposta.
- Erro de LLM/rede → 502 → UI: botão "tentar de novo".
- AGENT tentando acessar → 403 (guard). UI nem mostra o item.

## Testes

- **Backend (CopilotService):** com `LlmService` e executores mockados — (a) resolve agente por category; (b) executa 1 tool-call e monta a resposta; (c) aplica stripThink; (d) agente inexistente → 400. **RBAC:** AGENT no endpoint → 403.
- **Frontend:** renderiza a página; envia pergunta e mostra resposta; item do menu **não** aparece para AGENT.

## Entrega

- Código via **PR** (um API, um Web), base `feat/conversation-tabs`. Deploy no VPS pelo Kleber (rebuild), como nos outros.
- **Migração: nenhuma** na v1 (stateless).
- Pré-requisito já satisfeito: agente Copiloto + 7 skills já em prod.
