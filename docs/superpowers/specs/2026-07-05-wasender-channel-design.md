# Design — Canal WhatsApp via WasenderAPI (fluxo híbrido)

**Data:** 2026-07-05
**Status:** Aprovado
**Repos afetados:** `chat-bullq-api` (backend adapter + endpoints de sessão) e `chat-bullq-web` (UI de cadastro + modal de QR)
**Base:** `feat/conversation-tabs` (branch de deploy live)

## Objetivo

Adicionar mais uma opção de cadastro de canal que permite conectar números de WhatsApp
via **WasenderAPI** — um gateway não-oficial baseado em sessão/QR, conceitualmente igual
ao `WHATSAPP_ZAPPFY` já existente. O operador cola um **Personal Access Token** da conta
Wasender e conecta o número via **QR Code exibido dentro do próprio app** (fluxo híbrido).

## Contexto arquitetural

O `channel-hub` usa arquitetura hexagonal com adapters isolados registrados num
`ChannelAdapterRegistry`. Hoje existem três: `WHATSAPP_ZAPPFY` (Uazapi), `WHATSAPP_OFFICIAL`
(Meta Cloud) e `INSTAGRAM`. Cada adapter só traduz o formato do provedor ↔ a *mensagem
normalizada* interna; todo o pipeline downstream (roteamento de conversa, enriquecimento de
contato, processamento de mídia, IA, transcrição) opera sobre a mensagem normalizada e
**não muda**.

O WasenderAPI é o análogo mais próximo do Zappfy:
- Envio: `POST /api/send-message` (texto e mídia via URL).
- Webhooks: `messages.upsert`, `messages.update`, `session.status`, `qrcode.updated` etc.
- Verificação de webhook: **comparação simples de secret** via header `X-Webhook-Signature`
  (não é HMAC) — usar `crypto.timingSafeEqual`, igual ao Zappfy.
- Gestão de sessão: `POST /api/whatsapp-sessions`, `GET .../qrcode`, `POST .../connect`,
  `GET /api/status`.

## Diferença essencial vs Zappfy: dois níveis de credencial

- **Personal Access Token** (nível conta) — gerencia sessões (criar, QR, connect, status).
- **Session API Key** (Bearer, gerado ao conectar) — envia mensagens via `/api/send-message`.

### Shape do `Channel.config`

```jsonc
{
  "personalToken": "...",   // gerencia a sessão (nível conta)
  "sessionId": "...",       // id da sessão no Wasender
  "sessionApiKey": "..."    // Bearer para /api/send-message
}
// webhookSecret → coluna Channel.webhookSecret (comparação timing-safe no inbound)
```

Tokens ficam em texto no `config`, consistente com Zappfy/WA Official/Instagram atuais.
Cifragem com o `CryptoService` existente fica como melhoria futura separada (não amplia
o escopo desta feature).

## Componentes

### Backend (`chat-bullq-api`)

1. **Migração Prisma**: adicionar `WHATSAPP_WASENDER` ao enum `ChannelType`.

2. **Novo adapter** `src/modules/channel-hub/adapters/wasender/` (espelha o Zappfy):
   - `wasender.module.ts`
   - `wasender.http-client.ts` — axios com dois contextos de auth: Personal Token (gestão de
     sessão) e Session API Key (envio). Métodos: `createSession`, `getQrCode`, `connectSession`,
     `getStatus`, `configureWebhook`, `sendRequest` (send-message), `getMediaBuffer`,
     `resolveInboundMediaUrl` (via `/api/decrypt-media`), `deleteMessage`.
   - `wasender.message-mapper.ts` — `normalizeInbound` / `normalizeStatus` / `denormalize`.
   - `wasender.inbound-adapter.ts` — `extractLocators` (sessionId/assinatura), `matchesChannel`,
     `validateWebhook` (compara `X-Webhook-Signature` com `webhookSecret`, timing-safe),
     `parseWebhook` (`messages.upsert`, `messages.update`, `session.status`).
   - `wasender.outbound-adapter.ts` — `sendMessage`, `sendTypingIndicator`, mídia, `deleteMessage`.

3. **Registrar** no `channel-hub.module.ts` (`registry.register(wasenderInbound, wasenderOutbound)`).

4. **Endpoints de sessão/QR** (fluxo híbrido) no `ChannelsController` (ou sub-controller `wasender`):
   - `POST /channels` (existente) — recebe `name` + `config.personalToken`. Na criação de canal
     `WHATSAPP_WASENDER`, o service cria a sessão no Wasender, **auto-configura o webhook**
     apontando para `/webhooks/WHATSAPP_WASENDER` + gera `webhookSecret`, e persiste
     `sessionId`/`sessionApiKey` no config.
   - `GET /channels/:id/wasender/qrcode` — retorna o QR atual.
   - `POST /channels/:id/wasender/connect` — dispara a conexão.
   - `GET /channels/:id/wasender/status` — poll: `connected` / `connecting` / `disconnected`.

### Frontend (`chat-bullq-web`)

1. **`WasenderIcon`** novo em `components/ui/icons.tsx`.
2. **`create-channel-dialog.tsx`**: 4º card "WhatsApp (WasenderAPI)". Schema = `name` +
   `personalToken`. Wizard ganha um **passo de QR**: após criar o canal, exibe o QR Code,
   faz polling de status e fecha sozinho ao conectar.
3. **`channel-card.tsx`**: botão **"Conectar / Reconectar"** que reabre o modal de QR — sessão
   QR cai (celular offline, logout) e precisa reparear sem recriar o canal.
4. **`channels.service.ts`**: métodos `getWasenderQr` / `connect` / `getWasenderStatus`.
5. Adicionar `WHATSAPP_WASENDER` à union `ChannelType` + suporte no `edit-channel-dialog.tsx`.

## Fluxo de dados

- **Inbound:** Wasender → `POST /webhooks/WHATSAPP_WASENDER` → `WebhookGatewayController`
  resolve o canal por `sessionId`/assinatura → `parseWebhook` → mensagem normalizada →
  pipeline atual (sem mudanças). Mídia recebida vem cifrada → `resolveInboundMediaUrl` usa
  `/api/decrypt-media` (espelha o Zappfy).
- **Outbound:** pipeline atual → `registry.getOutbound(WHATSAPP_WASENDER)` → `POST /api/send-message`
  com a Session API Key. Texto: `{ to, text }`; mídia: `{ to, imageUrl|videoUrl|documentUrl|audioUrl }`
  (nomes exatos dos campos confirmados contra o SDK oficial na implementação).

## Tratamento de erros

- **Desconexão:** webhook `session.status=disconnected` marca o canal como desconectado →
  operador reconecta pelo botão de QR.
- **Falha de envio:** propaga como o Zappfy (log + erro do pipeline outbound).
- **Personal Token inválido na criação:** o `POST /channels` falha com mensagem clara e o
  canal não é persistido.

## Testes

- Unit tests do `wasender.message-mapper` (normalize/denormalize).
- Unit tests do `wasender.inbound-adapter` (`validateWebhook` timing-safe + `matchesChannel`),
  no mesmo molde dos `.spec.ts` existentes.

## Fora de escopo (YAGNI)

- Cifragem dos tokens no `config` (melhoria futura separada).
- Grupos, enquetes, newsletters, reações (o adapter cobre texto + mídia + status, como o Zappfy).
- History sync (o Zappfy tem `sync-adapter`; Wasender fica sem sync na v1).
