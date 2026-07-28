# Embedded Signup — runbook de configuração

Passo a passo pra ligar o "Conectar WhatsApp" do OFP Chat. A parte de código
está pronta nas branches `feat/whatsapp-embedded-signup-v2` (API e web); o que
falta é a configuração no painel da Meta e o preenchimento do `.env`.

Pré-requisitos já concluídos (jul/2026): verificação da empresa ✅ e verificação
do acesso como **Provedor de Tecnologia** ✅.

---

## 1. Conferir o Acesso Avançado

`developers.facebook.com` → seu app → **Análise do app** → **Permissões e recursos**.

As duas precisam estar em **Acesso Avançado** (não "Padrão"):

- `whatsapp_business_management` — ler/gerir a WABA do cliente
- `whatsapp_business_messaging` — enviar mensagem em nome do cliente

Se ainda estiverem em Padrão, o `config_id` até nasce, mas o fluxo só funciona
com contas ligadas ao próprio app. Nada de cliente real.

## 2. Criar a configuração do Cadastro Incorporado

No painel de **Provedor de Tecnologia**, card "Personalize um novo fluxo de
integração" → **Começar**.

Ao final a Meta devolve um **ID de configuração**. É o `WA_ES_CONFIG_ID`.

> O mesmo ID vai pro backend (`WA_ES_CONFIG_ID`) e pro build do frontend
> (`NEXT_PUBLIC_WA_ES_CONFIG_ID`). Não é segredo — ele aparece no JS do
> navegador de qualquer jeito.

## 3. Escolher o PIN de registro

Número de **6 dígitos**, definido por você, usado no
`POST /{phone_number_id}/register` de todo número novo. Vai em `WA_REG_PIN`.

⚠️ **Anote em lugar seguro.** É o PIN da verificação em duas etapas do número.
Sem ele não dá pra registrar número novo nem re-registrar depois de troca de
nome de exibição.

⚠️ **Cota:** o `/register` aceita 10 chamadas por número numa janela móvel de
72h. Estourar devolve o erro `133016` e trava o registro por 72 horas. O código
já registra só uma vez por número (grava `registeredAt` no config do canal),
mas não fique testando à mão no mesmo número.

## 4. Webhook do app da plataforma

O app da plataforma recebe os webhooks de **todas** as WABAs conectadas, num
endpoint só:

```
https://api-ofpchat.explotek.pro/api/v1/webhooks/WHATSAPP_OFFICIAL
```

O "Token de verificação" cadastrado ali é o `WA_VERIFY_TOKEN`.

A assinatura é validada com o **app secret da plataforma** (`WA_APP_SECRET`),
com fallback pro `appSecret` do canal — canais antigos configurados à mão
continuam funcionando.

Campos a assinar: `messages` (obrigatório) e `message_template_status_update`.
`account_update` ainda **não é tratado** pelo código — ver "Pendências".

## 5. Preencher o `.env`

Backend (`.env` da API):

```
WA_APP_ID=
WA_APP_SECRET=
WA_ES_CONFIG_ID=
WA_VERIFY_TOKEN=
WA_API_VERSION=v24.0
WA_REG_PIN=
```

Frontend (precisa estar presente **no build**, não só em runtime):

```
NEXT_PUBLIC_WA_APP_ID=
NEXT_PUBLIC_WA_ES_CONFIG_ID=
```

Sem as duas do frontend, o botão mostra
"Embedded Signup nao configurado" e nem abre o popup.

## 6. Subir

```
docker compose up -d --build api web
```

`up -d --build`, não `restart` — `restart` não relê o `.env`.

---

## Teste

**Fase 1 — fluxo, sem enviar mensagem.**
Sandbox seria o ideal (App Dashboard → WhatsApp → Quickstart → Testing
Integrations → "Reivindicar conta de sandbox"), mas ele **não envia nem recebe
mensagem** e depende de cota de portfólio empresarial da conta pessoal.

Alternativa sem sandbox: rodar o fluxo com o portfólio real e escolher o
**número de teste da Cloud API** (Phone Number ID `1171269982738500`,
WABA `842254495415175`). Se der errado é só apagar o canal.

O que essa fase valida: popup, `postMessage`, campo `event`, troca do `code`
por token, leitura do número e criação do canal.

**Primeira coisa a verificar:** se o `postMessage` chegar sem
`phone_number_id`, o problema é o `extras` do `FB.login`. Hoje mandamos
`extras: { sessionInfoVersion: '3' }`; a doc do ES v4 mostra
`extras: { setup: {} }`. É uma linha em
`src/features/channels/components/create-channel-dialog.tsx`.

**Fase 2 — envio.** Só com número real. Nunca comece pelo
+55 11 5194-9395 (produção).

---

## Pendências conhecidas

- **`account_update` não tratado.** É o webhook que avisa banimento da WABA,
  mudança de tier, qualidade do número e aprovação de nome de exibição. Sem
  ele, um cliente do Sendtur pode ser banido e a gente só descobre pelo
  silêncio. Hoje o `parseWebhook` só trata `message_template_status_update`.
- **Coexistência não confirmada.** Não achamos na doc se o `/register` é
  obrigatório, proibido ou automático pro número que já roda no app do
  WhatsApp Business — que é o caso do número de produção. O código tenta
  registrar e não quebra se falhar (comportamento seguro), mas isso precisa
  ser respondido antes de encostar no +55 11 5194-9395.
- **Sem `deregister`.** Não há como desconectar o número de um cliente pela
  interface (`POST /{phone_number_id}/deregister`). Vai fazer falta no churn
  do Sendtur.
