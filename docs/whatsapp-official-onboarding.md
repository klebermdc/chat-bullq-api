# Onboarding: plugar um número na API oficial (Meta Cloud API)

> Objetivo: ligar um número na **WhatsApp Business Cloud API** (a mesma família de API oficial que a Umbler usa) usando o adapter `whatsapp-official` que **já existe** no projeto. Não requer código novo — é onboarding na Meta + criação de 1 Channel.

## Por que não precisa de código

O adapter `src/modules/channel-hub/adapters/whatsapp-official/` já cobre, idêntico ao uso atual:

- **Envio:** texto, imagem, áudio, vídeo, documento, sticker, location, reaction e **template (HSM)** com variáveis de `body`.
- **Recebimento:** texto, mídia (com download autenticado via token Meta), location, reaction e respostas de botão/lista.
- **Webhook:** valida `X-Hub-Signature-256` (HMAC SHA256 com o App Secret) e responde o GET de verification (`hub.challenge`).
- **Multi-número:** roteia cada webhook pelo `phone_number_id`, então número de teste e número real convivem sem conflito, e nada disso interfere na Umbler.

Lacunas conhecidas (não afetam este caso): não *envia* menu de botões interativos (o app nunca gera esse tipo de mensagem) e não *parseia* template recebido (raro/cosmético).

## URL do webhook (produção)

```
https://api-ofpchat.explotek.pro/api/v1/webhooks/WHATSAPP_OFFICIAL
```

- A rota é pública (isenta de auth) e usa raw body — pronta pro HMAC da Meta.
- `GET` nessa URL = verification; `POST` = mensagens recebidas.

---

## Fase 1 — Meta (developers.facebook.com)

1. **Criar o App:** *Create App* → tipo **Business** → adicionar o produto **WhatsApp**. Cria automaticamente uma **WABA de teste + número de teste grátis** e um **token temporário (24h)**.

2. **Validar na hora (sem risco):** em *WhatsApp → API Setup*, cadastre seu próprio celular como destinatário e envie o template `hello_world`. Chegou = base de pé.

3. **Configurar o webhook** (*WhatsApp → Configuration → Webhook*):
   - **Callback URL:** `https://api-ofpchat.explotek.pro/api/v1/webhooks/WHATSAPP_OFFICIAL`
   - **Verify Token:** invente uma string (ex.: `ofp-wpp-2026`) — guarde, vai no config do canal.
   - Clique *Verify and Save* (o backend responde o `hub.challenge` sozinho).
   - **Assine o campo `messages`** (botão *Subscribe*).

4. **Coletar as 4 credenciais:**
   - `phoneNumberId` e `businessAccountId` (WABA id) → *API Setup*
   - `appSecret` → *App Settings → Basic → App Secret*
   - **Token permanente** → *Business Settings → System Users*: criar system user, atribuir o app, gerar token com escopos `whatsapp_business_messaging` + `whatsapp_business_management`. (O token de 24h só serve pro teste do passo 2.)

5. **Plugar o número real:** *API Setup → Add phone number* → verificar por SMS/ligação → definir **nome de exibição** (passa por revisão da Meta) → definir **PIN de duas etapas**.
   - ⚠️ O número **não pode estar ativo no WhatsApp comum/Business**. Se estiver, apague a conta naquele aparelho antes.

---

## Fase 2 — Criar o Channel no app

Endpoint: `POST /api/v1/channels`
Auth: `Authorization: Bearer <JWT>` + header `x-organization-id: <orgId>` (role OWNER/ADMIN).

Body:

```json
{
  "type": "WHATSAPP_OFFICIAL",
  "name": "WhatsApp Oficial",
  "config": {
    "accessToken": "<token permanente do system user>",
    "phoneNumberId": "<API Setup>",
    "businessAccountId": "<WABA id>",
    "appSecret": "<App Settings → Basic>",
    "verifyToken": "ofp-wpp-2026"
  },
  "visibility": "ORG"
}
```

> Incluir `businessAccountId` faz o backend **auto-inscrever** o app na WABA (`subscribeApp` roda na criação). Depois é só mandar um "oi" pro número → cai no Inbox.

Use o script `scripts/create-wa-official-channel.sh` para automatizar login + criação.

---

## Estratégia de migração (sair aos poucos da Umbler)

1. Fase 1 (passos 1–4) **com o número de teste** + Channel de teste → valida ponta a ponta sem tocar na Umbler.
2. Passo 5 com o **número real** quando o app estiver validado. A Umbler segue rodando em paralelo.
3. Cutover final: migrar o número principal (aí ele sai da Umbler) — decisão para depois. Um mesmo número **não** roda nos dois sistemas ao mesmo tempo.
