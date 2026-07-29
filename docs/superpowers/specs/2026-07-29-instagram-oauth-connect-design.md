# Instagram — Conectar conta em 1 clique (Fatia 1)

**Data:** 2026-07-29
**Branch:** `feat/instagram-oauth-connect` (a partir de `fork/feat/conversation-tabs`)
**Escopo:** API + Web

## Problema

O OFP Chat já tem um adapter de Instagram completo e registrado no `channel-hub`
(`src/modules/channel-hub/adapters/instagram/`, ~1.125 linhas: inbound, outbound,
mapper, sync, contact enricher). O que falta não é código de mensageria — é o
caminho de entrada.

Hoje, conectar um Instagram exige colar à mão um Access Token, um App Secret e um
IG Business ID no formulário de criação de canal. Isso tem três defeitos:

1. Ninguém fora do time consegue fazer. Inviabiliza cliente white-label.
2. O token do Instagram vence em **60 dias**. Sem renovação, o canal morre em
   silêncio — o mesmo modo de falha do "Session has expired" do canal oficial e do
   apagão do `appSecret`.
3. O `igBusinessId` colado errado quebra o roteamento do webhook de um jeito difícil
   de diagnosticar.

Com a aprovação do App Review e o selo de Tech Provider obtidos em 26/07, a
verificação de negócio — a parte lenta — já está feita. O caminho está curto.

## Decisões tomadas

| Decisão | Escolha | Motivo |
|---|---|---|
| App Meta | Instagram como produto **dentro do app do WhatsApp** | Herda Verificação de Negócio + Tech Provider. O Instagram gera App ID/Secret próprios dentro do mesmo app, então o env ganha `IG_*` separados dos `WA_*`. |
| Permissões no App Review | `instagram_business_basic` + `instagram_business_manage_messages` + `instagram_business_manage_comments` | Um review só. `manage_comments` é o que a Fatia 2 (comentário→DM) precisa; pedir depois custa outra rodada de espera. |
| Fluxo OAuth | **Callback na API** com `state` assinado | Uma única `redirect_uri` registrada na Meta serve todos os domínios white-label (explotek.pro, sendtur.com.br, próximos). O `code` nunca encosta em JavaScript, o que elimina a corrida do React StrictMode. |
| Formulário manual | **Mantido** como fallback | Já existe e funciona; é a escotilha quando o OAuth quebra. Mesmo padrão do Embedded Signup do WhatsApp. |
| Renovação do token | Cron proativo + alerta ao OWNER | Renovação preguiçosa deixa canal quieto morrer sem ninguém saber. |
| Gate de janela 24h para IG | **Fora desta fatia** | Fatia 1.5, obrigatória antes de liberar IG para atendente de verdade. |

## Prior art

- `WhatsAppEmbeddedSignupService` (`adapters/whatsapp-official/whatsapp-embedded-signup.service.ts`)
  — a forma do `connect()`: troca de code → token → subscribe → upsert de canal.
- `WhatsAppPlatformConfigService` — credenciais do app da plataforma lidas do env.
- `InactivityWatchdogCron` (`modules/scheduling/inactivity/`) — job BullMQ repetível
  registrado no `onModuleInit`.
- `docs/whatsapp-embedded-signup-runbook.md` — molde do runbook de configuração na Meta.

## Mecânica do token (confirmada na doc da Meta)

```
POST api.instagram.com/oauth/access_token          → token curto (1 hora)
GET  graph.instagram.com/access_token
       ?grant_type=ig_exchange_token               → token longo (60 dias)
GET  graph.instagram.com/refresh_access_token
       ?grant_type=ig_refresh_token                → renova por mais 60 dias
```

Restrições que moldam o design:

- O `refresh` só funciona se o token tiver **≥ 24 h de idade** e ainda estiver válido.
- Token **sem uso por 60 dias expira em definitivo** e não pode ser renovado — só
  re-autenticando.
- O `user_id` devolvido pelo `/me?fields=user_id` é o que casa com o `entry.id` do
  webhook. **Não é** o `user_id` devolvido junto com o token curto. Trocar os dois é
  a origem do "self-healing" que o projeto `insta-p8` precisa fazer no webhook.

## Arquitetura

### Componentes novos (API)

**`InstagramPlatformConfigService`**
Gêmeo do `WhatsAppPlatformConfigService`. Lê do env: `IG_APP_ID`, `IG_APP_SECRET`,
`IG_REDIRECT_URI`, `IG_API_VERSION` (default `v24.0`), `IG_STATE_SECRET`,
`IG_RETURN_ALLOWLIST` (hosts separados por vírgula). Expõe `isConfigured`.

**`InstagramOAuthStateService`**
Assina e verifica o `state` do OAuth, que carrega a identidade através do redirect
da Meta (o JWT não sobrevive a ele).

- `sign({ organizationId, userOrganizationId, role, returnTo })` → base64url de
  `payload.hmacSHA256(payload, IG_STATE_SECRET)`, com `exp` de 10 minutos e `nonce`.
- `verify(state)` → confere assinatura, validade e **queima o nonce no Redis**
  (`SETNX` com TTL de 10 min), tornando o `state` de uso único.
- O `returnTo` é validado contra `IG_RETURN_ALLOWLIST`. Sem isso é redirect aberto.

O `organizationId` e o `role` de dentro do `state` são **confiáveis** porque nós mesmos
assinamos o payload com `IG_STATE_SECRET` no `/authorize`, atrás do JWT. Não são input
do usuário. É justamente por isso que o `/callback` pode rodar sem guard.

**`InstagramConnectService`**
O `connect({ code, state })`, na forma do `WhatsAppEmbeddedSignupService.connect()`:

1. `POST api.instagram.com/oauth/access_token` → token curto + `user_id` do login.
2. `GET graph.instagram.com/access_token?grant_type=ig_exchange_token` → token de 60 dias.
3. `GET graph.instagram.com/{v}/me?fields=user_id,username,profile_picture_url`
   → o `user_id` **daqui** vira o `igBusinessId`.
4. `POST graph.instagram.com/{v}/{user_id}/subscribed_apps` com
   `subscribed_fields=messages,messaging_postbacks,messaging_seen`.
   Sem esse passo o canal nasce mudo. Falha aqui **aborta** — não deixa canal órfão.
5. Upsert: `findActiveByTypeAndOrg(INSTAGRAM, orgId)` filtrando por
   `config.igBusinessId`. Atualiza se achar, cria via `ChannelsService.create` se não.
   Reconectar não duplica canal.

`config` gravado:

```jsonc
{
  "igBusinessId": "1784...",   // casa com entry.id do webhook
  "igUserId": "256...",        // id do login, guardado para diagnóstico
  "username": "lojax",
  "accessToken": "IGAA...",
  "tokenExpiresAt": "2026-09-27T...",
  "appSecret": "...",          // do env da plataforma, carimbado no canal
  "apiVersion": "v24.0",
  "connectedAt": "2026-07-29T..."
}
```

O `appSecret` é carimbado no canal porque o `InstagramInboundAdapter.validateWebhook`
lê `channel.config.appSecret` e **retorna `true` quando ele falta** (fail-open).
Carimbando sempre, canal conectado por OAuth nunca cai nesse ramo.

### Endpoints

| Rota | Guard | Comportamento |
|---|---|---|
| `GET /api/v1/channels/instagram/authorize` | JWT + OWNER/ADMIN | Devolve `{ url }` — a URL de `www.instagram.com/oauth/authorize` já com `state` assinado. |
| `GET /api/v1/channels/instagram/callback` | **nenhum** (quem chama é a Meta) | Recebe `code` + `state`, valida o state, chama `connect()`, redireciona para `returnTo` com `?ig=ok&channel=<id>` ou `?ig=erro&motivo=<slug>`. |

`redirect_uri` única registrada na Meta:
`https://api-ofpchat.explotek.pro/api/v1/channels/instagram/callback`

### Renovação do token

**`InstagramTokenRefreshCron`** — `@Processor('instagram-token-refresh', { concurrency: 1 })`,
registrando o job repetível no `onModuleInit` como o `InactivityWatchdogCron`.
Padrão em `IG_TOKEN_REFRESH_CRON`, default `0 4 * * *`.

Varre `findActiveByType(INSTAGRAM)` — todas as orgs, sem opt-in: um canal conectado é
um canal que a gente promete manter vivo.

- Faltam **> 15 dias** para o vencimento → não faz nada.
- Faltam **≤ 15 dias** → `GET graph.instagram.com/refresh_access_token`. Sucesso grava
  `accessToken`, `tokenExpiresAt` e `tokenRefreshedAt`, e zera `refreshFailures`.

A restrição de "token com ≥ 24 h de idade" se satisfaz sozinha: um token só entra na
janela de renovação com ~45 dias de vida.

**Em caso de falha**, nessa ordem:

1. `config.refreshFailures` incrementa; `config.lastRefreshError` guarda a mensagem.
2. `notifyOrgAgents({ type: SYSTEM, ... })` avisa a org. O enum `NotificationType` já
   tem `SYSTEM` — **não precisa de migration**.
3. Throttle de 24 h por canal em Redis (`SETNX` + TTL), no espírito do throttle de
   15 min do fail-loud do channel-hub.

**O cron NÃO desativa o canal.** Canal com token vencido continua `isActive: true`.
Desativar recriaria o apagão do Comercial: canal inativo faz o webhook descartar
inbound em silêncio. Token morto degrada o **envio**; não pode derrubar a **recepção**.

### Web

- Botão "Conectar Instagram" no `create-channel-dialog.tsx`, ao lado do formulário
  manual (que permanece). Chama `/authorize` e faz `window.location.href = url`.
- A página de canais lê `?ig=ok|erro` na volta e mostra toast.
- `channel-card.tsx` ganha selo de aviso quando `tokenExpiresAt` está a menos de 15
  dias ou já passou, com botão "Reconectar" que dispara o mesmo `/authorize`.

**Nenhuma variável `NEXT_PUBLIC_*` nova** — o web só fala com a nossa API. Logo, nada
de mexer nos `ARG` do Dockerfile do web, que foi o que quebrou no Embedded Signup do
WhatsApp (`3b5d360`).

## Tratamento de erro

Slugs estáveis no redirect de volta; a mensagem crua da Meta vai só para o log.

| Slug | Causa |
|---|---|
| `state_invalido` | Assinatura ruim, expirado, ou nonce já queimado |
| `code_expirado` | O `code` tem 1 hora de validade, ou já foi usado |
| `permissao_negada` | Usuário cancelou na tela da Meta |
| `sem_conta_business` | Conta pessoal, não profissional — o erro de suporte mais comum |
| `falha_inscricao` | O `subscribed_apps` falhou |
| `erro_interno` | Qualquer outra coisa |

O `code` e o `accessToken` **nunca** são logados inteiros — no máximo 12 caracteres de
prefixo, o suficiente para distinguir "segredo errado" de "corpo mutilado".

## Testes

Unitários com axios mockado, seguindo `whatsapp-embedded-signup.service.spec.ts`.

**`InstagramOAuthStateService`**
- assina e verifica ida e volta
- rejeita assinatura adulterada
- rejeita `state` expirado
- rejeita nonce reusado
- rejeita `returnTo` fora da allowlist

**`InstagramConnectService`**
- caminho feliz grava o `user_id` do `/me` como `igBusinessId` (**não** o do token)
- reconexão atualiza o canal existente em vez de criar outro
- falha no `subscribed_apps` aborta e não deixa canal órfão
- `code` e token não aparecem inteiros no log

**`InstagramTokenRefreshCron`**
- não toca em canal com 30 dias restantes
- renova canal com 10 dias restantes
- em falha, notifica uma vez; na rodada seguinte respeita o throttle
- **não desativa o canal** em nenhum cenário de falha

## Definição de pronto

O OAuth funcionar não basta. O adapter de Instagram nunca foi provado ponta a ponta
com uma conta real. Pronto é:

1. Conectar uma conta IG profissional pelo botão.
2. Mandar um DM do celular → **ver a conversa aparecer no inbox**.
3. Responder pelo inbox → **ver a resposta chegar no celular**.
4. Forçar uma renovação de token à mão e confirmar que o canal continua funcionando.

Se o DM não fluir, a fatia não está pronta.

**Isso não depende do App Review.** Em modo de desenvolvimento o app Meta funciona com
contas que tenham papel de admin/dev/tester nele. Dá para construir e provar tudo com
a conta da OFP antes de submeter — e o screencast do review sai desse mesmo E2E.

## Fora de escopo

- Gate de janela de 24 h para Instagram (**Fatia 1.5**, antes de liberar para atendente)
- Comentário → DM e gatilhos de story (**Fatia 2**)
- Sync histórico via `instagram.sync-adapter.ts`
- Publicação de conteúdo (`instagram_business_content_publish`)

## Configuração na Meta (runbook)

Documento curto no repo, no molde do `whatsapp-embedded-signup-runbook.md`:

1. Adicionar o produto **Instagram** ao app Meta existente.
2. Pegar o **App ID e App Secret do Instagram** — não são os do WhatsApp. Ficam na
   página do produto Instagram, não em Configurações → Básico.
3. Registrar a `redirect_uri` única, caractere por caractere.
4. Assinar os campos de webhook: `messages`, `messaging_postbacks`, `messaging_seen`.
5. Submeter o App Review com as três permissões, usando o screencast do E2E.

## Env novo

```
IG_APP_ID=
IG_APP_SECRET=
IG_REDIRECT_URI=https://api-ofpchat.explotek.pro/api/v1/channels/instagram/callback
IG_API_VERSION=v24.0
IG_STATE_SECRET=
IG_RETURN_ALLOWLIST=sendtur.com.br
IG_TOKEN_REFRESH_CRON=0 4 * * *
```

A `IG_RETURN_ALLOWLIST` deve ser preenchida com os hosts **reais** servidos pelo Caddy
no VPS — conferir lá antes de fixar. O apex `explotek.pro` está morto e o app vive hoje
em `sendtur.com.br`; chutar um host aqui faz todo `returnTo` legítimo ser rejeitado.

Lembrete de deploy: as variáveis vivem no `docker-compose.yml` do VPS, que **não é
versionado**. Adicionar lá antes de subir, senão o `isConfigured` fica falso e o botão
não aparece.

## Riscos

| Risco | Mitigação |
|---|---|
| O adapter de IG nunca foi provado E2E; pode ter bugs latentes | A definição de pronto exige o E2E. Se aparecer bug, ele entra nesta fatia — não vira débito. |
| App Review pode pedir ajustes e atrasar a liberação para cliente | O E2E roda em modo dev antes do review. O review deixa de ser bloqueio inicial. |
| `notifyOrgAgents` notifica a org toda, não só o OWNER | Aceitável nesta fatia. O fail-loud do channel-hub (API #139, ainda **aberto**) traz o filtro por papel; quando mergear, apertar aqui. |
| Segredo do app duplicado no `config` de N canais | Mesmo trade-off que o WhatsApp oficial já faz hoje. Consistente com o existente. |

## Lacunas conhecidas (achadas na implementação, decisão pendente)

**1. Corrida entre dois `connect()` simultâneos para a mesma conta.**
`connect()` lê (`findActiveByTypeAndOrg` + `find` por `igBusinessId`) e depois escreve,
sem transação nem lock. Duas conexões concorrentes da mesma conta IG leem a lista vazia
e ambas criam canal — resultando em **dois canais ativos com o mesmo locator**, que é a
mesma forma de colisão que já causou apagão aqui.

Atenuantes: o nonce do `state` é de uso único, então um callback repetido é rejeitado; a
corrida exige duas autorizações completas e concorrentes, o que é estreito. Mas a
consequência é grave o bastante para não ficar sem registro.

Fechar exige uma decisão de arquitetura, por isso não entrou na Fatia 1:
- **Índice único no banco** — `Channel.config` é `Json`, então precisa de coluna gerada
  (`igBusinessId`) + unique index, ou seja, migration.
- **Lock no Redis** por `igBusinessId` durante o `connect()` — sem migration, mas exige
  injetar um cliente Redis no `InstagramConnectService`, que hoje não tem.

**2. Rotação do `IG_APP_SECRET` deixa canais antigos com segredo velho.**
O `appSecret` é carimbado no `config` no momento da conexão e nunca revisitado. Se o
segredo do app rodar na Meta, todo canal conectado antes da rotação continua com o valor
antigo e passa a recusar webhook por assinatura inválida. Não há mecanismo de re-carimbo.
Procedimento operacional documentado no runbook; automatizar é trabalho futuro.
