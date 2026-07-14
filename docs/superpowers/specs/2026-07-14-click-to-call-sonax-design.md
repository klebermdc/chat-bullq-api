# Click to Call (Sonax) — Design

**Data:** 2026-07-14
**Autor:** brainstorming OFP Chat
**Status:** Aprovado (aguardando revisão do spec)

## Objetivo

Adicionar um botão de telefone 📞 no header da conversa do inbox que permita ao
atendente **iniciar uma ligação telefônica com o cliente** via discador de voz da
**Sonax** (PABX/Call Center na nuvem que a OFP já usa), e **registrar o resultado
da ligação na timeline da conversa** (status, duração e link da gravação).

Não é WebRTC/chamada no navegador. É o modelo clássico **"click to call ramal-first"**
da Sonax: ao clicar, a Sonax toca o **ramal do próprio atendente** primeiro
(softphone/aparelho dele) e, quando ele atende, disca para o cliente e conecta os dois.

## Contexto / integração Sonax

Referência: doc "API de integração de Voz (Sonax Pabx e Call Center)".

- **Iniciar chamada (click2call ramal-first):**
  `GET https://click2call.sonax.net.br/sonax-click2call.php?numero=<cliente>&ramal=<ramal>&token=<token>`
- **Autenticação Sonax:** `id_cliente` + `token` (fornecidos pela Sonax na criação da
  campanha). Atenção: 3× `404` consecutivos bloqueiam novos envios.
- **Variáveis customizadas `var_1`..`var_5`:** disponíveis **apenas** na API de Click
  to Call; retornam no webhook de desligamento. Usamos `var_1 = call.id` para
  correlacionar o webhook assíncrono de volta à conversa.
- **Webhook de desligamento:** a Sonax faz uma requisição para uma URL configurada no
  painel dela, substituindo placeholders. Relevantes:
  `<ID_CHAMADA>`, `<STATUS_CHAMADA>`, `<STATUS_ATENDIMENTO>` (S/N), `<DURACAO_CHAMADA>`,
  `<URL_GRAVACAO>` (só vai na URL de desligamento), `<VAR1>`..`<VAR5>`.
- **Status de chamada Sonax:** `discando`, `andamento`, `falando`, `ramal atendeu`,
  `ramal falhou`, `ocupado`, `indisponível`, `desligada`.

### O que o cliente (OFP) precisa obter/configurar na Sonax
1. **`id_cliente` + `token`** da API de voz (gerenciador Sonax / suporte).
2. **Ramal (extensão) de cada atendente** — já existe; o atendente precisa estar
   logado no ramal (softphone aberto/aparelho ligado) na hora de clicar.
3. **Cadastrar a URL de webhook** (gerada pelo chat, com secret embutido) no campo de
   **URL de desligamento** da campanha/discador na Sonax.
4. (Opcional) Confirmar a base do `click2call` caso a instância use outro domínio.

## Decisões (do brainstorming)

- **Ramal por atendente**, cadastrado pelo **ADMIN/OWNER na tela de Membros**.
- **Credencial Sonax por organização**, token **criptografado** (reusa
  `KEY_ENCRYPTION_SECRET` do menu de Provedores de IA).
- **Disparo feito no backend** (nunca no navegador) — protege o token e evita CORS.
- **Escopo: iniciar + registrar no chat** (recebe webhook de desligamento).
- **Persistência: model `Call` dedicado** (fonte da verdade, pronto p/ relatório) +
  **mensagem SYSTEM** espelhada na timeline (reusa `Message`).

## Arquitetura (fluxo ponta-a-ponta)

```
[Atendente] --clica 📞--> [Web] --POST /conversations/:id/call--> [API NestJS]
   1. valida: ramal do atendente? creds Sonax da org (enabled)? nº do contato?
   2. cria Call(status=DIALING) + Message SYSTEM "📞 Ligação iniciada por Fulano"
   3. GET click2call...?numero=<cli>&ramal=<ramal>&token=<tk>&var_1=<call.id>
[Sonax] toca o ramal do atendente -> ele atende -> disca pro cliente -> conversam
   (ao desligar) --GET/POST--> /public/webhooks/sonax/:secret?var_1=<call.id>&status=...&duracao=...&url_gravacao=...
   4. acha Call por var_1, valida org pelo :secret, atualiza status/duração/gravação
   5. atualiza a Message SYSTEM -> "✅ Atendida · 3m12s · ▶️ gravação"
   6. emite evento realtime (timeline atualiza sozinha)
```

Fios de costura: **`var_1 = call.id`** (correlação) e **`:secret` por org** (autenticação
do webhook Sonax + escopo de tenant).

## Modelos de dados (Prisma)

### Ramal por atendente — em `UserOrganization` (per-org)
```prisma
model UserOrganization {
  // ...
  sonaxRamal String? @map("sonax_ramal") // ex: "101"; null = atendente não pode ligar
}
```

### Credencial Sonax por organização — model novo
```prisma
model SonaxSettings {
  id                String   @id @default(cuid())
  organizationId    String   @unique @map("organization_id")
  enabled           Boolean  @default(false)
  idCliente         String   @map("id_cliente")
  tokenEnc          String   @map("token_enc")       // criptografado
  webhookSecret     String   @map("webhook_secret")  // gerado por nós; vai na URL do webhook
  click2callBaseUrl String   @default("https://click2call.sonax.net.br/sonax-click2call.php") @map("click2call_base_url")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")
  organization      Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  @@map("sonax_settings")
}
```

### Registro da ligação — model `Call`
```prisma
enum CallStatus { DIALING RINGING TALKING ANSWERED NO_ANSWER BUSY FAILED FINISHED }

model Call {
  id             String     @id @default(cuid())
  organizationId String     @map("organization_id")
  conversationId String     @map("conversation_id")
  agentId        String     @map("agent_id")     // User que clicou
  ramal          String                          // snapshot do ramal usado
  numero         String                          // nº discado (normalizado)
  status         CallStatus @default(DIALING)
  answered       Boolean    @default(false)
  durationSec    Int?       @map("duration_sec")
  recordingUrl   String?    @map("recording_url")
  messageId      String?    @map("message_id")   // a Message SYSTEM espelhada
  startedAt      DateTime   @default(now()) @map("started_at")
  endedAt        DateTime?  @map("ended_at")
  raw            Json       @default("{}")        // payload bruto do webhook (auditoria)
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  conversation   Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  agent          User         @relation(fields: [agentId], references: [id], onDelete: SetNull)
  @@index([organizationId, startedAt])
  @@index([conversationId])
  @@map("calls")
}
```

### Timeline — reusa `Message`
Uma `Message` com `type=SYSTEM`, `direction=OUTBOUND`, `senderId=<atendente>` e
`content = { kind: "call", callId, status, durationSec, recordingUrl }`. Sem enum novo
em `MessageContentType` (SYSTEM já existe). O `Call.messageId` aponta pra ela.

### Mapa status Sonax → `CallStatus`
| Sonax | CallStatus | answered |
|---|---|---|
| discando | DIALING | — |
| andamento | RINGING | — |
| falando | TALKING | — |
| ramal atendeu | ANSWERED | — |
| ocupado | BUSY | N |
| indisponível / ramal falhou | NO_ANSWER | N |
| desligada | FINISHED | S se STATUS_ATENDIMENTO=S |

`answered` é derivado de `<STATUS_ATENDIMENTO>` (S/N) quando presente.

## Backend — módulo `calls` (`src/modules/calls/`)

### POST /conversations/:id/call (autenticado; RBAC: qualquer membro da org)
1. Carrega conversa (valida org do usuário) + contato → telefone.
2. Guardas com erro claro:
   - sem número → `400 "conversa sem telefone"`
   - `SonaxSettings.enabled=false`/ausente → `400 "Sonax não configurada"`
   - `UserOrganization.sonaxRamal` ausente → `400 "configure seu ramal em Membros"`
3. Normaliza número (`normalizeBrazilNumber`: só dígitos, garante DDI 55).
4. Cria `Call(DIALING)` + `Message` SYSTEM; grava `messageId` no Call.
5. Descriptografa token; **GET** para `click2callBaseUrl` com `numero`, `ramal`,
   `token`, `var_1=call.id`. Timeout ~8s, `try/catch`. Falha da Sonax → `Call=FAILED`,
   atualiza a mensagem ("❌ falha ao iniciar"), retorna `502`.
6. Retorna `{ callId, status }`; emite evento realtime.

### GET|POST /public/webhooks/sonax/:secret (público, sem JWT)
1. Acha `SonaxSettings` por `webhookSecret == :secret` → resolve a org. Não achou → `404`.
2. Lê `var_1` → carrega `Call` (valida `Call.organizationId == org do secret` →
   anti cross-tenant).
3. Mapeia status; grava `durationSec`, `recordingUrl` (de `url_gravacao`), `endedAt`,
   `raw`, `answered`.
4. Atualiza a `Message` SYSTEM espelhada; emite evento realtime.
5. Responde `200` rápido. **Idempotente** (reprocessar não duplica nada). Nunca deixar
   estourar `404` para payload válido (Sonax bloqueia após 3× 404).

### GET/PUT /organizations/settings/sonax (RBAC: OWNER/ADMIN)
- Salva `enabled`, `idCliente`, `token` (criptografa; **nunca** devolve em claro —
  devolve só `tokenConfigured: boolean`).
- Gera `webhookSecret` na 1ª vez; devolve a **URL de webhook pronta pra colar** no
  painel Sonax.

### Ramal na tela de Membros
Estende o endpoint de update de membro para aceitar `sonaxRamal`
(RBAC: OWNER/ADMIN, mesma regra do reset de senha).

### Segurança
- Token criptografado em repouso.
- SSRF não se aplica: `click2callBaseUrl` é config de admin/allowlist, não input livre do
  usuário final; número é normalizado no servidor.
- Webhook autenticado por `secret` por org + escopo de tenant no lookup do `Call`.
- Token nunca retorna em claro em nenhuma resposta de API.

## Frontend

### Botão 📞 no header (`conversation-header.tsx`)
- Só em **conversa individual com telefone** (escondido em grupo/sem número). Usa
  `[&>*]:shrink-0` no wrap (pegadinha conhecida de vazamento da barra de ações).
- Estados: normal → loading → "chamando…" (enquanto Call em DIALING/RINGING/TALKING).
- Desabilitado com tooltip quando: atendente sem ramal / Sonax off.
- Confirmação leve antes de discar (evita clique acidental).

### Card de ligação na timeline
Renderiza `Message` SYSTEM `kind=call`: "📞 Ligação iniciada por Fulano" → ao concluir
"✅ Atendida · 3m12s · ▶️ ouvir gravação" ou "❌ Não atendida / Ocupado". Atualiza em
tempo real quando o webhook chega.

### Config Sonax (nova aba em Configurações; OWNER/ADMIN)
Liga/desliga, `id_cliente`, `token` (mascarado, mostra "configurado ✓"), e a **URL de
webhook pronta pra copiar**.

### Ramal na tela de Membros
Campo "Ramal Sonax" por membro, ao lado do ícone de chave (reset de senha), mesma RBAC.

## Testes (TDD)

**Backend:**
- `normalizeBrazilNumber` (dígitos, DDI 55).
- Guardas de pré-condição (sem ramal / sem creds / sem número).
- Disparo monta a URL correta e trata falha da Sonax (→ FAILED + 502).
- Webhook mapeia cada `status` Sonax → `CallStatus`; **idempotente**; **rejeita
  cross-tenant** (secret de org A não atualiza Call de org B).
- Token nunca retorna em claro.

**Frontend:**
- Botão escondido em grupo; desabilitado sem ramal; card renderiza cada estado.

## Fora de escopo (YAGNI / futuro)
- Relatório dedicado de ligações (a tabela `Call` já deixa pronto; a tela é fatia futura).
- Login/logout/pausa de atendente na Sonax (a doc suporta; não é necessário pro MVP).
- Discador em fila (`queue2call`) — só o ramal-first por enquanto.
- Chamada WebRTC no navegador.

## Runbook de implantação (resumo)
1. Migração Prisma (`sonaxRamal`, `SonaxSettings`, `Call`, enum `CallStatus`).
2. Garantir `KEY_ENCRYPTION_SECRET` no ambiente (já existe pro menu de IA).
3. OFP abre chamado na Sonax: obter `id_cliente` + `token`; configurar a URL de
   desligamento (gerada pelo chat) na campanha.
4. Preencher config Sonax na org + ramal de cada atendente.
5. E2E: clicar 📞 numa conversa de teste → ramal toca → atende → disca → desliga →
   card atualiza com duração + gravação.
