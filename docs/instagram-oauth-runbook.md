# Runbook — Conectar Instagram (OAuth)

Fluxo "Instagram API with Instagram Login". Não usa Facebook Login e não usa o
Instagram Basic Display.

## Configuração na Meta (uma vez)

1. Abrir, em developers.facebook.com, o **mesmo app Meta que já hospeda o WhatsApp**
   — ele já tem Verificação de Negócio e Tech Provider, que é a parte lenta.
2. Adicionar o produto **Instagram** → "API setup with Instagram business login".
3. Copiar o **Instagram App ID** e o **Instagram App Secret** dessa página para
   `IG_APP_ID` / `IG_APP_SECRET`. Não são os do WhatsApp e não são os de
   Configurações → Básico. Essa é a confusão nº 1 de quem monta esse fluxo.
4. Em "Business login settings", cadastrar a OAuth redirect URI:
   `https://api-ofpchat.explotek.pro/api/v1/channels/instagram/callback`
   Caractere por caractere: https, sem barra no fim. Uma URI só serve todos os
   domínios white-label — o `returnTo` assinado no state é que decide o retorno.
5. Em Webhooks, assinar os campos `messages`, `messaging_postbacks`, `messaging_seen`.

### ⚠️ Ovo e galinha: o canal tem que existir ANTES de validar o webhook

O "Verificar e salvar" da Meta falha com *"Não foi possível validar a URL de callback
ou o token de verificação"* se ainda não houver **nenhum canal INSTAGRAM criado** no
OFP Chat.

Não é erro de URL nem de token. O `handleVerification` do
`webhook-gateway.controller` varre os canais ativos daquele tipo e testa o
`webhookSecret` de cada um — com a lista vazia, o laço não roda e ele devolve
`403 {"error":"Verification failed"}`. A GET de verificação não tem payload para
rotear, então não há como o gateway adivinhar o token de um canal que não existe.

Ordem correta:

1. Gerar o Access Token na Meta (passo "Adicionar conta").
2. **Criar o canal no OFP Chat**, preenchendo o *Webhook Verify Token* com a mesma
   string que você vai pôr na Meta.
3. **Só então** clicar em "Verificar e salvar" na Meta.
4. Assinar os campos de webhook.

Para distinguir esse caso de uma API fora do ar, chame a verificação na mão:

```bash
curl -i "https://api-ofpchat.explotek.pro/api/v1/webhooks/INSTAGRAM?hub.mode=subscribe&hub.verify_token=<SEU_TOKEN>&hub.challenge=teste"
```

- `403 {"error":"Verification failed"}` → é a nossa resposta: a rota está viva e o
  problema é canal inexistente ou token divergente.
- 502 / timeout / HTML → é infraestrutura (Caddy, API fora), não é isto.
- Devolveu `teste` cru → está tudo certo.
6. Preencher as `IG_*` no `docker-compose.yml` do VPS (que **não é versionado**) e
   subir com `docker compose up -d`. `restart` **não** relê o ambiente.

## Testar antes do App Review

Em modo de desenvolvimento o app funciona normalmente com contas que tenham papel
de admin/dev/tester nele. Dá para fazer o E2E inteiro com a conta da OFP antes de
submeter — e o screencast do review sai desse mesmo E2E. O review deixa de ser
bloqueio inicial e vira o último passo antes de abrir para cliente.

## App Review

Submeter as três permissões de uma vez:
`instagram_business_basic`, `instagram_business_manage_messages`,
`instagram_business_manage_comments`.

A terceira não é usada na Fatia 1 — ela existe para a Fatia 2 (comentário→DM).
Pedir agora evita uma segunda rodada de espera depois.

## Rotação do `IG_APP_SECRET` — procedimento manual obrigatório

O `appSecret` é **copiado para o `config` de cada canal** no momento da conexão, e
nunca revisitado. Isso fecha um fail-open (o `validateWebhook` do adapter aceita o
webhook quando o campo falta), mas cria uma dívida: **se o segredo rodar na Meta,
todo canal conectado antes da rotação continua com o valor antigo e passa a recusar
todos os webhooks por assinatura inválida.**

O sintoma é exatamente o do incidente do App Secret do WhatsApp: canal marcado como
ativo, nada chegando, e nenhuma pista óbvia.

Depois de rotacionar o segredo na Meta:

1. Atualizar `IG_APP_SECRET` no `docker-compose.yml` do VPS e `docker compose up -d`.
2. Re-carimbar os canais existentes:
   ```sql
   UPDATE channels
      SET config = jsonb_set(config, '{appSecret}', '"<NOVO_SEGREDO>"')
    WHERE type = 'INSTAGRAM' AND deleted_at IS NULL;
   ```
3. Conferir em `webhook_events` que voltou a entrar evento.

Alternativa sem SQL: reconectar cada canal pelo botão, que re-carimba o segredo.
Viável com poucos canais, inviável com muitos.

## Renovação do token

O token vale 60 dias. O `InstagramTokenRefreshCron` roda todo dia às 04:00
(`IG_TOKEN_REFRESH_CRON`) e renova quem está a 15 dias ou menos do vencimento
(`IG_TOKEN_REFRESH_THRESHOLD_DAYS`).

Se a renovação falhar, OWNER e ADMIN recebem notificação (no máximo uma por canal a
cada 20h) e o card do canal mostra o selo de vencimento. **O canal continua ativo de
propósito** — token morto degrada o envio, mas não pode derrubar a recepção.

Um token que fica 60 dias sem uso nem renovação expira **em definitivo** e não pode
mais ser renovado: só reconectando pelo botão.

## Diagnóstico

| Sintoma | Causa provável |
|---|---|
| Botão "Conectar Instagram" some ou dá 400 | `isConfigured` falso — falta alguma `IG_*` no container. Conferir com `docker compose exec api env \| grep IG_` |
| 400 citando `IG_RETURN_ALLOWLIST` | O host de onde o usuário clicou não está na allowlist |
| Volta com `motivo=state_invalido` | `IG_STATE_SECRET` mudou entre o /authorize e o /callback, ou o link foi reusado (o state vale uma vez só, por 10 min) |
| Volta com `motivo=sem_conta_business` | A conta do Instagram é pessoal. Converter para Comercial ou Criador no app do Instagram |
| Volta com `motivo=code_expirado` | O code vale 1h e uma vez só. Refazer |
| Volta com `motivo=falha_inscricao` | O `subscribed_apps` falhou — conferir se a permissão de mensagens saiu do App Review |
| Conectou mas não chega mensagem | Conferir em `webhook_events` se chega evento; se chega e é descartado, comparar o `entry.id` do payload com `config.igBusinessId` do canal |
| Parou de chegar mensagem em TODOS os canais IG de uma vez | Suspeitar de rotação do App Secret — ver a seção acima |

## Lacunas conhecidas

- **Conexões concorrentes da mesma conta** podem criar dois canais ativos com o
  mesmo `igBusinessId`. Exige duas autorizações completas e simultâneas, então é
  estreito, mas não há trava. Detalhes no spec.
- **Sem gate de janela de 24h** para Instagram nesta fatia: uma resposta enviada
  fora da janela falha com erro da Meta em vez de ser barrada antes.
