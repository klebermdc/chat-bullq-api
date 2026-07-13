# Camada de Transporte — Canal "OFP Chat" (Baileys self-hosted)

**Data:** 2026-07-13
**Status:** Design aprovado — pronto para virar plano de implementação
**Autor:** brainstorming OFP Chat

---

## 1. Contexto e motivação

Hoje o OFP Chat conecta números de WhatsApp não-oficiais (Baileys) **através de terceiros**
— Wasender, Zappfy e uazapi — que hospedam o Baileys por nós e expõem uma API HTTP + webhooks.

A dor: **queremos parar de depender desses intermediários e hospedar o Baileys nós mesmos**,
num serviço próprio no nosso VPS. Ganhamos controle (sessão, número, dados), tiramos custo/risco
de terceiros e viabilizamos o white-label sem expor o nome "Baileys" ao cliente final.

### O que JÁ existe (não reconstruir)

O sistema **já tem** uma camada de transporte multi-provider madura, em produção:

- Ports (contratos): `channel-hub/ports/inbound-channel.port.ts`, `outbound-channel.port.ts`,
  `history-sync.port.ts`.
- Adapters: `wasender`, `whatsapp-official` (Meta Cloud), `zappfy`, `instagram`.
- Roteamento: `channel-hub/channel-adapter.registry.ts`.
- Ingestão de webhooks: `channel-hub/webhook-gateway.controller.ts`.
- O core (SDR Aline, cadência, inbox, distribuição) **nunca soube** qual provedor está atrás
  de um número — só conversa com os ports.

> O prompt original (`prompt-camada-transporte-whatsapp.md`) assume um stack Supabase + Vercel Edge
> + React/Vite e um sistema "100% acoplado à Cloud API". **Isso não corresponde ao OFP Chat**
> (NestJS + Prisma + Postgres + Docker/VPS, já multi-provider). Este spec adapta a intenção do
> prompt à realidade: em vez de *construir* a camada de transporte, adicionamos **um novo adapter**
> (`WHATSAPP_OFP`) e **um novo serviço gateway** que hospeda o Baileys.

## 2. Escopo

### Objetivo
Adicionar um canal **"OFP Chat"** = Baileys hospedado por nós, como **mais uma opção** na prateleira
de canais, convivendo com Wasender/Zappfy/Cloud API **sem tocar no core**.

### Decisões travadas no brainstorming
- **Coexistência:** canal **novo em paralelo** (`ChannelType WHATSAPP_OFP`). Wasender/Zappfy
  seguem intactos. Migração de números no ritmo do usuário, sem big-bang.
- **Escala v1:** poucos números (1 a ~10), operação OFP + testes. Design **enxuto**.
- **Nome:** "OFP Chat" para o usuário final. Nada de "Baileys" na tela. Internamente
  `WHATSAPP_OFP` / serviço `gateway-ofp`.
- **Integração gateway↔core (Abordagem A):** o gateway se comporta como um **provedor externo**,
  idêntico em forma ao Wasender. Sem outbox no core.
- **Gate de aviso de risco:** exibido e **aceito ANTES** de liberar a conexão (dupla trava: UI + gateway).

### Fora de escopo (v1 — YAGNI consciente)
- Outbox durável no Postgres (durabilidade fica na fila Redis do gateway).
- Sharding multi-processo (só o `instanceId` por número fica pronto como costura).
- Warmup progressivo de 7 dias e anti-ban avançado (bloqueio por não-resposta etc.).
- Broadcast / disparo em massa.
- Realtime de verdade no QR (usamos polling; gancho para SSE/WS depois).

## 3. Arquitetura

### Topologia
```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  chat-bullq-api (NestJS)     │        │  gateway-ofp (Node, novo)    │
│  container "api"             │        │  container novo no compose   │
│                              │        │  rede "internal", sem porta  │
│  adapter WHATSAPP_OFP        │─POST──▶│  HTTP interno /instances/... │
│   (inbound + outbound port)  │  send  │  ├ Baileys sockets (N sessões)│
│                              │        │  ├ auth state cifrado (Postgres)│
│  webhook-gateway.controller  │◀─POST──│  ├ fila+retry (Redis)         │
│   (JÁ EXISTE, reusado)       │ inbound│  └ rate-limit humanizado      │
└──────────────┬───────────────┘        └───────────────┬──────────────┘
               │                                         │
               └──────────► Postgres (mesmo) ◄───────────┘
                     (tabela ofp_sessions só p/ gateway)
```

### Fluxo de saída
1. Core chama `adapter.sendMessage()` (não sabe que é Baileys).
2. Adapter `ofp` → `POST /instances/:id/send` no gateway.
3. Gateway enfileira (Redis), aplica rate-limit humanizado (jitter + "digitando"),
   envia via socket Baileys, responde `{ externalId }`.
4. Gateway offline → `POST` falha → mensagem marcada como falha + canal vira `disconnected`.

### Fluxo de entrada
1. Socket Baileys recebe evento.
2. Gateway normaliza e faz `POST` assinado (HMAC) no `webhook-gateway.controller` **existente**.
3. Pipeline de ingestão atual roda **sem alteração** — cai no inbox.
4. Echo do celular pareado entra como `source: 'device'` sem duplicar (reconciliação de conteúdo
   que já existe do fix de echo do Wasender).

### Princípio-chave
O gateway é, para a API, **só mais um provedor HTTP com webhook**. Todo o "Baileys" fica trancado
dentro do container `gateway-ofp`. O core **nunca importa** nada de Baileys.

## 4. O serviço `gateway-ofp`

Node puro (NÃO Nest, NÃO Bun) + Baileys + Express mínimo. Container próprio, rede `internal`,
sem porta pública. Responsabilidades:

1. **Gerência de sessões.** No boot, lê canais `WHATSAPP_OFP` ativos e sobe 1 socket por número.
   1 processo hospeda N sessões. `instanceId = channelId` (costura de sharding pronta).
2. **Auth state cifrado — do zero (sem `useMultiFileAuthState`).** Implementa `AuthenticationState`
   persistindo em `ofp_sessions`, blob cifrado **AES-256-GCM** reusando `KEY_ENCRYPTION_SECRET`
   (mesmo padrão de `ai-provider-keys`). Nunca em arquivo, nunca em claro, **nunca logado**.
3. **Conexão/QR.** `POST /instances/:id/connect` (gera QR/pairing code, gravado efêmero),
   `GET /instances/:id/status`, `POST /instances/:id/logout`. **Recusa `/connect` sem aceite de risco
   registrado** no canal.
4. **Reconexão com backoff + classificação de disconnect.** Distingue `loggedOut`/`banned`
   (definitivo → status `disconnected`/`banned`, não reconecta, avisa o painel) de transiente
   (reconecta com backoff exponencial). Publica status via `POST` no webhook controller.
5. **Rate-limit humanizado interno (sem lib de terceiro — auditável):**
   - Jitter por número: média ~6s, desvio ~2s, mínimo 3s.
   - `presence update` "digitando" proporcional ao tamanho do texto antes de enviar.
   - Fila por número no Redis (serializa envios do mesmo número).
6. **Mídia inbound re-hospedada na origem** (URL do nosso domínio), resolvendo o `.enc` do Baileys
   antes de entregar ao core.
7. **README de risco** no container (ver §8).

## 5. O adapter `WHATSAPP_OFP` (chat-bullq-api)

Módulo novo `channel-hub/adapters/ofp/`, espelhando o `wasender`. Implementa os ports existentes,
**zero mudança no core**.

- **`ofp.outbound-adapter.ts`** (`OutboundChannelPort`):
  - `sendMessage()` → `POST /instances/:id/send`.
  - `sendTypingIndicator()` → repassa ao gateway.
  - `resolveInboundMediaUrl()` → mídia já re-hospedada pelo gateway; quase echo.
  - `deleteMessage()` → `POST /instances/:id/delete` (Baileys apaga-para-todos → **habilitado**).
  - `getRateLimits()` → declara limites; aplicação real é no gateway.
- **`ofp.inbound-adapter.ts`** (`InboundChannelPort`):
  - `extractLocators()` / `matchesChannel()` → casa payload com canal via `config.instanceId`.
  - `validateWebhook()` → confere HMAC do gateway (padrão Wasender).
  - `parseWebhook()` → normaliza evento do gateway (mapper fino).
- **`ofp.module.ts`** → registra inbound+outbound no `ChannelAdapterRegistry` no boot.

### Capabilities declaradas
- `supportsTemplates: false` → cadência manda **texto comum** (não HSM), respeitando rate-limit do
  gateway. Mesmo caminho já usado pelos canais não-oficiais.
- `has24hWindow: false`, `supportsCTWA: false`, `requiresQrSession: true`, `supportsReadReceipts: true`.

### Config do canal (`Channel.config` JSON — sem coluna nova)
`{ instanceId, gatewayBaseUrl, webhookSecret, riskAcceptedAt, riskAcceptedBy }`.

## 6. UI — conexão QR + gate de aviso (chat-bullq-web)

Reaproveita o fluxo de "adicionar canal" existente. "OFP Chat" vira mais uma opção de tipo.

1. **Escolher "OFP Chat"** na lista de tipos.
2. **Gate de aviso (obrigatório, ANTES de conectar).** Modal com o texto de risco. Botão "Conectar"
   **desabilitado** até marcar "Li e aceito o risco". Ao aceitar, grava `riskAcceptedAt` +
   `riskAcceptedBy` em `config`. **Sem aceite → sem QR** (gateway também recusa `/connect`).
3. **Tela de QR.** Cria o canal → `POST /instances/:id/connect` (via API, nunca do browser) →
   QR aparece e atualiza. **Entrega do QR por polling curto** (~2s) no endpoint de status do canal,
   até `status = connected`. (Gancho para SSE/WS depois, sem mexer no resto.)
4. **Pareou → `connected`**, QR some, canal operante.

### Badge no header da conversa
"OFP Chat · Conexão QR" + bolinha de status (verde `connected` / âmbar `connecting` /
vermelho `disconnected|banned`). Reusa o espaço de badges existente.

### SDR Aline e cadência
**Nenhum ajuste.** Só conhecem os ports; respondem igual num número OFP Chat e num Cloud API.
Única diferença observável: o badge.

## 7. Modelo de dados

- **Enum:** `+ WHATSAPP_OFP` em `ChannelType` (migração aditiva).
- **Tabela nova `ofp_sessions`** (só o gateway acessa):
  ```
  id           uuid pk
  channel_id   uuid fk -> Channel   (= instanceId)
  auth_state   bytea       -- AES-256-GCM, NUNCA em claro
  qr_code      text null   -- efêmero, limpo após parear
  status       text        -- connecting|connected|disconnected|banned
  last_seen_at timestamptz
  updated_at   timestamptz
  ```
- **Sem colunas novas em `Channel`** — resto vai em `Channel.config` (JSON).

## 8. Segurança / risco

- Auth state = **credencial**: cifrado em repouso (AES-256-GCM via `KEY_ENCRYPTION_SECRET`),
  nunca logado, tabela acessível só pelo gateway/service role.
- HMAC nos webhooks gateway→API (mesmo padrão Wasender).
- Gateway sem porta pública (rede `internal`).
- **README de risco** no container + **gate de aceite** no onboarding: conexão Baileys é
  não-oficial, viola os ToS do WhatsApp, número pode ser banido a qualquer momento
  independentemente de volume/boas práticas; a operação principal da OFP permanece na Cloud API
  oficial. O aceite do tenant é registrado (`riskAcceptedAt/By`).
- **Nada de pacotes "anti-ban" de terceiros** (houve caso de pacote malicioso exfiltrando sessões).
  Rate-limit humanizado é implementado internamente, simples e auditável.

## 9. Testes

- **Adapter (unit, Nest):** message-mapper (inbound→normalizado), validação HMAC, capabilities,
  roteamento por `instanceId`. Espelha os testes do `wasender`.
- **Gateway (unit):** store de auth state (cifra→decifra round-trip; nunca vaza em log),
  classificação de disconnect (loggedOut vs transiente), rate-limit (jitter ≥ 3s, serialização
  por número).
- **E2E de aceite (manual, VPS):** parear 1 número via QR → receber msg no inbox → responder pelo
  inbox → mandar msg pelo celular pareado e ver o echo (`source: device`) sem duplicar.

## 10. Fatiamento (3 fatias deployáveis, em ordem)

| Fatia | Entrega | Critério de aceite |
|---|---|---|
| **1 — Fundação** | Enum `WHATSAPP_OFP`, tabela `ofp_sessions`, adapter `ofp` (inbound/outbound/capabilities/HMAC), gateway mínimo (health + `/send` stub) no compose. | Canal "OFP Chat" aparece e é registrado no core; testes unitários verdes. Nada conecta ainda — risco zero. |
| **2 — Gateway Baileys real** | Sessão Baileys + auth state cifrado, `connect/QR/status/logout`, gate de aviso na UI, inbound→webhook, outbound real, echo `device`. | Parear número, receber, responder, ver echo. Marco que prova a tese. |
| **3 — Robustez + UI** | Rate-limit humanizado, reconexão c/ backoff + classificação ban/logout, badge de status + polling do QR, README de risco. | Número cai → status reflete na tela; envios saem humanizados; reconecta sozinho quando transiente. |

Cada fatia é deployável e reversível sozinha. Fatia 1 não liga nada em prod; Fatia 2 conecta o
primeiro número de teste; Fatia 3 endurece.

## 11. Deploy

- Novo serviço `gateway-ofp` no `docker-compose.yml` (rede `internal`, sem porta pública),
  reusando Postgres/Redis/MinIO já presentes.
- Variáveis: reusa `KEY_ENCRYPTION_SECRET`, `DATABASE_URL`, `REDIS_URL`; nova
  `GATEWAY_OFP_BASE_URL` (interna) consumida pelo adapter.
- Migração Prisma aditiva (enum + tabela) roda no boot da API (padrão do projeto).
- Segue a convenção do projeto: **deploy via PR** na branch viva `feat/conversation-tabs`,
  nunca push direto.
