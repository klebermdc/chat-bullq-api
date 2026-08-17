# Fatia 0 — Sonda de Permissão de Comentários

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Descobrir, por teste com o token real, se o OFP Chat consegue receber webhook de comentário e responder por DM privada sem esperar App Review.

**Architecture:** Nenhum código de produção. É uma sonda manual contra a API da Meta, cujo resultado decide se a Fatia 3 leva dias ou semanas. O entregável é um documento de veredito commitado no repo.

**Tech Stack:** Meta Graph API v21.0, Meta DevTools MCP, `curl`.

**Spec:** `docs/superpowers/specs/2026-08-17-sair-do-manychat-design.md`

**Worktree:** nenhum. Roda na branch de docs corrente.

---

## Contexto que o executor precisa saber

**Por que esta fatia existe.** O levantamento em 17/08/2026 mostrou
`instagram_manage_comments` com estado `REJECTED` no app `1498969635088115`, e
`submission_status` = `UNSUBMITTED`. Ao mesmo tempo, o canal Instagram **já
opera em produção** nesse app apesar de `instagram_business_basic` também
constar `REJECTED`.

Isso só se explica de uma forma: a Meta permite usar permissão não aprovada em
ativos onde o usuário tem cargo no app (admin, desenvolvedor ou testador). Se
essa regra valer também para `comments`, o comment-to-DM liga sem App Review.

**Isso é hipótese, não fato.** A documentação da Meta é ambígua e mudou várias
vezes. A única forma de saber é testar.

**Não altere nada em produção.** A assinatura de webhook é feita no app, e o
callback aponta para a API que está no ar. Um payload de comentário chegando num
endpoint que não sabe tratá-lo cai no caminho de "payload desconhecido" e
devolve 200 + log — comportamento já existente e inofensivo. Ainda assim,
confira o log depois.

---

## Task 1: Levantar o estado atual antes de mexer

- [ ] **Step 1: Registrar as assinaturas de webhook existentes**

Use o Meta DevTools MCP:

```
devtools_webhook_list(action="list_subscriptions", app_id="1498969635088115")
```

Esperado hoje: uma única assinatura, tópico `whatsapp_business_account`.

Anote a saída literal. Se ela divergir do esperado, **pare e reporte** — alguém
mexeu na configuração desde 17/08 e o resto do plano parte de premissa falsa.

- [ ] **Step 2: Registrar os tópicos disponíveis**

```
devtools_webhook_list(action="list_topics", app_id="1498969635088115")
```

Anote se `instagram` aparece na lista e quais campos ele oferece. O campo que
interessa chama-se `comments`.

- [ ] **Step 3: Descobrir qual app serve o canal Instagram em produção**

O app `879570195107436` está vazio (zero permissões, zero webhooks), então o
Instagram de produção pode estar num terceiro app não concedido ao DevTools MCP.

Confira no banco de produção qual `appId` o canal Instagram usa:

```sql
SELECT id, name, type, external_id
FROM channels
WHERE type = 'INSTAGRAM' AND deleted_at IS NULL;
```

E no `.env` de produção, qual `META_APP_ID` está configurado.

**Se o app do Instagram não for o `1498969635088115`, todo o resto deste plano
muda de alvo.** Anote o app correto e use-o nas tarefas seguintes.

- [ ] **Step 4: Commitar o levantamento**

Crie `docs/superpowers/notes/2026-08-17-sonda-comentarios.md` com as três saídas
acima, literais, sob o título `## Estado antes da sonda`.

```bash
git add docs/superpowers/notes/2026-08-17-sonda-comentarios.md
git commit -m "docs: estado das assinaturas de webhook antes da sonda de comentarios"
```

---

## Task 2: Assinar o campo `comments`

- [ ] **Step 1: Assinar o tópico**

```
devtools_webhook_manage(
  action="subscribe",
  app_id="<app do Instagram, da Task 1 Step 3>",
  topic="instagram",
  fields=["comments"]
)
```

Se a chamada devolver erro de permissão, **esse já é o veredito**: a permissão é
necessária e não está disponível. Pule para a Task 5 e registre o resultado como
`BLOQUEADO`.

- [ ] **Step 2: Confirmar que a assinatura existe**

```
devtools_webhook_list(action="list_subscriptions", app_id="<mesmo app>")
```

Esperado: agora aparecem duas assinaturas, e a nova tem `topic: instagram` com
`comments` na lista de `fields`.

- [ ] **Step 3: Assinar a conta do Instagram no app**

Assinar o tópico no app não basta — a conta do Instagram precisa estar inscrita:

```bash
curl -X POST "https://graph.instagram.com/v21.0/me/subscribed_apps" \
  -d "subscribed_fields=comments" \
  -d "access_token=$IG_TOKEN"
```

Esperado: `{"success":true}`.

Se devolver erro, copie o campo `error.message` **inteiro** — é ele que diz se
falta permissão e qual.

---

## Task 3: Provar que o webhook chega

- [ ] **Step 1: Comentar num post real**

Pelo aplicativo do Instagram, de uma conta que **não** seja a
`@orlando.fastpass`, comente uma palavra reconhecível num post recente do
perfil. Use algo improvável como `sondateste17ago`.

- [ ] **Step 2: Procurar o payload no log da API**

```bash
ssh <vps> 'docker logs --since 5m <container-da-api> 2>&1 | grep -i "comment\|changes"'
```

Esperado se funcionou: uma linha de webhook recebido contendo `"field":"comments"`.

Esperado se não funcionou: nada.

- [ ] **Step 3: Registrar o payload literal**

Se chegou, copie o JSON inteiro do `entry[]` para o documento de sonda, sob
`## Payload de comentário recebido`. **Esse payload é o insumo da Fatia 3** — o
plano dela vai escrever o parser contra ele, e um parser escrito contra um
payload inventado não funciona.

Anonimize apenas o `from.id` e o `from.username` se for de terceiro.

---

## Task 4: Provar que a resposta privada funciona

Só execute se a Task 3 chegou a receber payload.

- [ ] **Step 1: Chamar a private reply**

Use o `comment_id` do payload recebido:

```bash
curl -X POST "https://graph.instagram.com/v21.0/<COMMENT_ID>/private_replies" \
  -d "message=Oi! Vi seu comentario, posso te ajudar por aqui?" \
  -d "access_token=$IG_TOKEN"
```

Esperado se funcionou: `{"id":"<message-id>"}` e a DM aparece na conversa do
Instagram.

- [ ] **Step 2: Registrar o resultado**

Copie a resposta literal. Em caso de erro, copie `error.message`, `error.code` e
`error.error_subcode` — os três. O `error_subcode` é o que distingue "falta
permissão" de "janela expirada" de "já respondido".

- [ ] **Step 3: Testar o limite de uma resposta por comentário**

Rode o mesmo `curl` do Step 1 uma segunda vez, no mesmo `comment_id`.

Esperado: erro. Copie o `error_subcode` literal — a Fatia 3 precisa dele para
distinguir "já usei" de falha real, e é ele que vai para o campo
`privateReplyError`.

---

## Task 5: Escrever o veredito

- [ ] **Step 1: Fechar o documento com a conclusão**

Acrescente ao `docs/superpowers/notes/2026-08-17-sonda-comentarios.md`:

```markdown
## Veredito

**Resultado:** LIBERADO | BLOQUEADO

- Webhook de comentário chega: sim/não
- `private_replies` responde 200: sim/não
- Segunda tentativa no mesmo comentário: <error_subcode literal>
- App usado: <app_id>
- Token usado: <tipo — IG token / Page token>

**Consequência para a Fatia 3:** <uma frase>
```

- [ ] **Step 2: Se o resultado for BLOQUEADO, corrigir o rascunho de submissão**

O rascunho `1614258483559229` está `UNSUBMITTED` e contém
`instagram_business_basic` e `instagram_business_manage_messages`. Falta
`instagram_business_manage_comments`.

Adicione a permissão faltante ao rascunho no painel de App Review e registre no
documento o que foi adicionado e o que ainda falta para submeter (vídeo de
demonstração, instruções de teste, URL de política de privacidade).

**Não submeta sem o Kleber revisar** — o app já tem uma rejeição no histórico, e
uma segunda rejeição custa mais tempo que uma semana de espera.

- [ ] **Step 3: Reverter a assinatura se o resultado for BLOQUEADO**

Assinatura ativa num campo que a API não sabe tratar gera log de lixo sem
utilidade. Se o veredito foi BLOQUEADO, desfaça:

```
devtools_webhook_manage(action="unsubscribe", app_id="<app>", topic="instagram", fields=["comments"])
```

Se o veredito foi LIBERADO, **deixe a assinatura ativa** — a Fatia 3 vai usá-la.

- [ ] **Step 4: Commitar**

```bash
git add docs/superpowers/notes/2026-08-17-sonda-comentarios.md
git commit -m "docs: veredito da sonda de permissao de comentarios"
```

---

## Critério de pronto

O documento de sonda existe, está commitado, e responde com evidência literal
(não com interpretação) a duas perguntas: o webhook de comentário chega, e a
resposta privada funciona. Se qualquer uma for "não", o documento diz o que
falta para virar "sim".
