# Canal Facebook Messenger no Inbox — Design

**Data:** 2026-08-17
**Base:** `fork/feat/conversation-tabs` (branch viva)
**Branch:** `feat/messenger-channel`

## Problema

Mensagens que chegam na Página do Facebook ficam na caixa de entrada da Meta,
fora do OFP Chat. Não são distribuídas, não passam pela Aline, não entram no
funil, e leads vindos de anúncios Click-to-Messenger não têm atribuição.

## Objetivo

Messenger como canal de primeira classe do inbox: recebe, responde, respeita a
janela de 24h, captura a origem do anúncio e importa o histórico da Página.

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| Quem atende | Aline, igual ao WhatsApp | Pipeline já é agnóstico de canal; custo zero |
| Fora da janela 24h | Bloquear com motivo legível | Não depende de App Review; falha visível no painel |
| Origem do lead | Capturar referral do CTM | Dado só vem uma vez; perdido é perdido |
| Histórico | Sincronizar | Paridade com o Instagram |
| Estrutura do código | Adapter novo + extração mínima | DRY onde a repetição é real, sem refatorar o Instagram inteiro |

### Por que não a tag HUMAN_AGENT

A Meta permite responder até 7 dias com a tag `HUMAN_AGENT`, o que cobriria
quase toda a cadência. Descartada nesta fatia por dois motivos: exige a
permissão aprovada em App Review, e a política restringe o uso a **resposta
manual humana** — usar em disparo automático de cadência é violação.

Consequência aceita: **cadência longa não roda no Messenger.** Toques além de
24h serão bloqueados com motivo explícito.

## Arquitetura

### Util compartilhado (novo)

`src/modules/channel-hub/adapters/meta-shared/meta-signature.util.ts`

Duas funções puras, extraídas do adapter do Instagram por serem idênticas:

- `verifyMetaSignature(headers, rawBody, appSecret): boolean` — HMAC
  `X-Hub-Signature-256` com `timingSafeEqual`
- `handleMetaVerification(query, verifyToken): VerificationResponse` —
  handshake `hub.mode` / `hub.verify_token` / `hub.challenge`

O `instagram.inbound-adapter.ts` passa a chamar as duas. É a **única** alteração
em código do Instagram que está no ar — substituição de corpo de função por
chamada equivalente, coberta pelos testes atuais.

**Os mappers ficam separados de propósito.** Eles divergem de verdade: o
Instagram tem story mention e reels; o Messenger tem postback, quick reply,
referral e o tipo `sticker`. Unificá-los produziria abstração vazando.

### Adapter novo

`src/modules/channel-hub/adapters/messenger/` — sete arquivos espelhando a
estrutura do Instagram: `inbound-adapter`, `message-mapper`, `outbound-adapter`,
`http-client`, `contact-enricher`, `sync-adapter`, `module`.

Diferenças em relação ao molde:

| Peça | Instagram | Messenger |
|---|---|---|
| Host do Graph | `graph.instagram.com` | `graph.facebook.com` |
| Token | Token IG | Page Access Token |
| Locator (`entry[].id`) | IG Business ID | **Page ID** |
| Enriquecimento | `/me` | `/{PSID}?fields=first_name,last_name,profile_pic` |
| Sync | `/me/conversations?platform=instagram` | `platform=messenger` |
| Eventos extras | story mention, reels | postback, quick_reply, referral |

### Rota do webhook

Nenhuma mudança de controller. O gateway é genérico
(`@Post(':channelType')` em `webhook-gateway.controller.ts:52`), então adicionar
`MESSENGER` ao enum e registrar o adapter já cria
`POST /api/v1/webhooks/MESSENGER`.

### Gate de janela

`WhatsappWindowGate` é renomeado para **`MetaWindowGate`** — um serviço chamado
"Whatsapp" que gateia Messenger é um nome que mente. Rename mecânico; o
compilador acha toda referência.

A regra passa de `channelType !== 'WHATSAPP_OFFICIAL'` para aceitar também
`MESSENGER`. **A extensão de 72h do CTWA é exclusiva do WhatsApp**: o cálculo
deve ignorar `ctwaClidAt` quando o canal for Messenger, onde a janela é sempre
24h.

Escopo exato do rename, para não ficar ambíguo: renomeiam-se o serviço
`WhatsappWindowGate` → `MetaWindowGate` e seu arquivo. O helper
`computeWhatsappWindow` e `whatsapp-window.util.ts` **mantêm o nome** — a lógica
de janela deles continua sendo majoritariamente regra de WhatsApp (24h/72h
CTWA), e renomear tudo ampliaria o diff sem ganho.

### Frontend

Ícone novo do Messenger, mais o tipo adicionado nos arquivos que já fazem
`switch` por canal: `channel-types.ts`, `create-channel-dialog.tsx`,
`edit-channel-dialog.tsx`, `channel-card.tsx`, `conversation-list.tsx`,
`conversation-header.tsx`, `kanban-card.tsx`, `inbox-tree.tsx`.

Repetitivo, mas é o padrão existente — nenhuma abstração nova aqui.

## Fluxo de dados

### Entrada

Webhook → gateway → `extractLocators` (devolve o Page ID) → resolve canal →
valida assinatura → `parseWebhook` → fila → `inbound-message.processor` →
resolve contato → resolve conversa → Aline.

Só o adapter é novo; o resto do caminho já existe.

### Captura do anúncio (Click-to-Messenger)

A Meta entrega o referral em **dois lugares** conforme a thread ser nova:

| Situação | Onde vem | Tem `message`? |
|---|---|---|
| Thread nova, veio de anúncio | `messaging[].message.referral` | Sim |
| Thread existente, pessoa voltou pelo anúncio | `messaging[].referral` (evento solto) | **Não** |

Ambos preenchem o `InboundReferral` que já existe:

- `sourceId` ← `referral.ad_id`
- `sourceType` ← `'ad'` quando `source === 'ADS'`
- `ctwaClid` ← vazio (não existe no Messenger)

O segundo caso é evento sem mensagem: **não gera item no inbox**, só atualiza a
atribuição da conversa. Tratá-lo como "mensagem sem conteúdo" produz mensagem
fantasma no chat.

**Mudança necessária:** `tagAdLeadIfReferral` hoje começa com
`if (!params.ctwaClid) return false`
(`lead-source-tagger.service.ts:138`). Como lead de Messenger nunca tem
`ctwaClid`, precisa aceitar também `sourceType === 'ad'` — senão a tag
"Anúncio" nunca aparece.

A chave de origem `AD` e a tag `"Anúncio"` já existem em
`lead-origin.constants.ts`. Nenhuma chave nova.

### Fora de escopo: evento Purchase na CAPI

O disparo do Purchase é ancorado no `ctwa_clid`, que só existe no WhatsApp.
Leads de Messenger **não** gerarão evento na CAPI nesta fatia. Dá para resolver
depois pelo `ad_id`, mas é outro trabalho.

### Mídia

Anexo chega como `attachments[].payload.url` — CDN da Meta, que expira. Nunca
guardar essa URL como fonte permanente (regra 5 do projeto).

**Mecanismo (rastreado):** a re-hospedagem é feita pelo `MediaResolverService`,
que é **agnóstico de canal** — ele chama `adapter.downloadMedia(channel, url)`
pelo registry e grava via `uploads.saveInboundMedia`. O Messenger herda esse
caminho de graça, bastando implementar `downloadMedia` no adapter de saída.

Correção em relação a uma versão anterior deste texto: a re-hospedagem é **sob
demanda** (na primeira vez que a mídia é pedida), não no momento da ingestão. Se
falhar, o serviço cai de volta na URL do provedor sem cachear, para a próxima
tentativa refazer.

**Figurinha tem prazo.** Até **30/08/2026** a Meta manda os dois tipos
(`sticker` e `image`); depois disso, só `sticker`. O mapper prioriza `sticker` e
usa `image` apenas como retaguarda — funciona nas duas eras e não quebra sozinho
na virada.

### Saída

`send()` enfileira → `outbound-message.processor` → **gate de janela** →
`POST /me/messages` em `graph.facebook.com`.

O Messenger não tem reply nativo no Send API. Usa-se a mesma degradação já
implementada para o Instagram: cita o trecho como `> texto` no corpo, via o
contrato `replyTo`.

## Configuração na Meta (manual, fora do código)

1. Adicionar o produto Messenger ao app
2. Gerar o Page Access Token da Página
3. Assinar a Página em **`messages` E `messaging_referrals`** — assinar só o
   primeiro perde a atribuição das threads que já existiam
4. Permissões: `pages_messaging`, `pages_manage_metadata`
5. Classificar o bot como **hybrid**, não "automated" — a classificação
   "automated" carrega a exigência de responder qualquer entrada em 30 segundos

No app: criar o canal em Configurações → Canais com Page ID, Page Access Token,
App Secret e Verify Token.

## Erros

- Payload desconhecido → 200 + log. Nunca 500 para a Meta, que desativa a
  assinatura após falhas repetidas.
- Assinatura inválida → 401, sem processar.
- Falha de envio → grava `failedReason` com o motivo real da Meta, não o
  `"Request failed with status code 400"` genérico.

## Testes

**Mapper (alvo principal):** texto; anexo; figurinha nos dois formatos; referral
em thread nova; referral em thread existente (sem mensagem); postback; mesmo
payload duas vezes (idempotência).

**Util compartilhado:** assinatura válida, inválida e ausente; handshake com
token certo e errado.

**Gate:** canal Messenger dentro e fora das 24h; confirmação de que o CTWA de
72h não vaza para o Messenger.

**Regressão:** a suíte atual do Instagram precisa passar sem alteração após a
extração do util.

## Fora de escopo

- Tag `HUMAN_AGENT` e cadência longa no Messenger
- Evento Purchase na CAPI para leads de Messenger
- One-Time Notification e Sponsored Messages
- Lead Generation Ads (webhook com pares pergunta/resposta)
- OAuth via Facebook Login — segue o padrão de colar token, igual ao Instagram
