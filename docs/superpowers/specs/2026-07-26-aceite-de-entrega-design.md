# Aceite de Entrega — Design

**Data:** 2026-07-26
**Projeto:** OFP Chat (`chat-bullq-api` / `chat-bullq-web`)
**Status:** Aprovado — pronto para o plano de implementação

## Problema

Ao entregar ingressos/vouchers (ou qualquer produto), a Orlando Fast Pass quer um
**aceite eletrônico** do cliente: ele confere os produtos que comprou, declara que
está tudo correto e "assina". Serve como comprovante em disputas do tipo
"não recebi" / "veio errado".

## Decisões (fechadas no brainstorming)

- **Mecanismo:** página web com assinatura eletrônica simples (link enviado no WhatsApp),
  não botão nativo nem resposta por texto.
- **Gatilho:** o botão/automação **"Pedido enviado" (E6 — Entrega)** que o atendente já
  aciona. Ao clicar, além de mover o card, gera o link de aceite.
- **Itens conferidos:** o **atendente monta/edita na hora** — rascunho puxado da
  **Ficha do Pedido (`OrderFicha`)**, ajustável antes de gerar o link.
- **Pós-aceite:** (1) mensagem SYSTEM no chat + selo no card, (2) comprovante em PDF,
  (3) status do aceite no card/drawer. Notificação sonora fica como plugagem futura.
- **Arquitetura:** módulo próprio isolado `acceptances` (Abordagem A). Não estende
  `OrderFicha`.

## Arquitetura

Módulo novo `acceptances` no `chat-bullq-api`, com model próprio, controller autenticado
(atendente) e controller público (assinatura pelo cliente). Rota pública mobile-first no
`chat-bullq-web`. Reusa `StorageService`, `render.service` (Chromium/Playwright),
decorator `@Public()` e o padrão de mensagem SYSTEM no thread.

### 1. Modelo de dados — `OrderAcceptance`

Migration **aditiva** (novo model + novo enum). Não altera `OrderFicha`/`Proposal`.

| Campo | Tipo | Nota |
|---|---|---|
| `id` | String @id | cuid |
| `organizationId` | String | escopo multi-tenant (sem RLS — filtro em toda query) |
| `conversationId` | String | conversa de origem |
| `contactId` | String | cliente |
| `cardId` | String? | card do funil, quando houver |
| `token` | String @unique | random 32 bytes base64url — segredo que protege a página pública |
| `items` | Json | snapshot editado: `[{ description, qty?, date?, note? }]` |
| `termText` | String | snapshot do termo exibido (PDF sai idêntico ao que o cliente viu) |
| `status` | enum `AcceptanceStatus` | `PENDING · SIGNED · EXPIRED · CANCELED` |
| `createdById` | String | atendente que gerou |
| `createdAt` | DateTime @default(now()) | |
| `expiresAt` | DateTime? | expiração **soft**, default +30 dias, regenerável |
| `signedAt` | DateTime? | |
| `signerName` | String? | nome digitado pelo cliente |
| `signerIp` | String? | trilha de auditoria |
| `signerUserAgent` | String? | trilha de auditoria |
| `pdfKey` | String? | chave do comprovante no `StorageService` |

Índices: `@@unique([token])`, `@@index([organizationId, conversationId])`.

### 2. Fluxo ponta-a-ponta

1. Atendente clica **"Pedido enviado"** → abre `AcceptanceDialog` (web).
2. Diálogo puxa itens da **Ficha do Pedido** como rascunho editável + o termo default
   (editável). Atendente ajusta e confirma.
3. `order-sent` (endpoint estendido), num passo só:
   - **(a)** cria `OrderAcceptance` `PENDING` (token, snapshot de `items` + `termText`, `expiresAt = +30d`);
   - **(b)** envia no WhatsApp a mensagem com o link `.../aceite/<token>`;
   - **(c)** move o card pra "Pedido enviado" (comportamento atual **preservado**).
   - **Escape hatch:** opção "só marcar enviado, sem aceite" mantém o fluxo antigo.
4. Cliente abre o link → página pública lista **empresa + itens + termo + campo nome +
   checkbox** "conferi e está tudo correto".
5. Cliente assina → status→`SIGNED`, captura `signedAt/IP/userAgent`, gera PDF, dispara
   os efeitos da seção 4. Página mostra "✅ Aceite confirmado" + baixar comprovante.

### 3. Página pública + PDF

- Rota pública mobile-first no `chat-bullq-web`: `/aceite/[token]` (cliente abre no celular).
  Consome `GET /public/acceptances/:token` e posta em `POST /public/acceptances/:token/sign`
  (ambos `@Public()`).
- Estados: `PENDING` → formulário; `SIGNED` → confirmação + download; `EXPIRED`/`CANCELED`
  → mensagem apropriada (410/409).
- PDF do comprovante: HTML do termo assinado → `chromium.setContent` → `page.pdf()` →
  `StorageService.upload('acceptances/YYYY-MM-DD/<id>.pdf')`. Reusa o Chromium já na imagem.

### 4. Onde o atendente vê

- **Mensagem SYSTEM** no chat em tempo real:
  `✅ Cliente confirmou o recebimento — {nome} em dd/mm hh:mm`.
- **Selo no card:** `Aceite: Pendente / Assinado / Expirado` (via `metadata.acceptance` +
  realtime `card:updated`).
- **Drawer do card (`ClientCardDrawer`):** bloco "Aceite de entrega" com status, itens
  conferidos, data/hora, IP/dispositivo, link do PDF e botão **"Reenviar link"**.

## Endpoints

Autenticado (atendente):
- `POST conversations/:conversationId/order-sent` — **estendido** com body
  `{ items, termText, withAcceptance: boolean }`. Cria aceite + envia link + move card.
- `POST acceptances/:id/resend` — reenvia o link (renova `expiresAt`).
- `GET conversations/:conversationId/acceptance` — status/dados pro drawer.

Público (`@Public()`):
- `GET public/acceptances/:token` — dados pra página (404 se inexistente; 410 se expirado).
- `POST public/acceptances/:token/sign` — body `{ name }`; valida `PENDING` + não expirado
  (senão 409/410), grava assinatura, gera PDF, dispara efeitos.

## Validade jurídica

Assinatura **eletrônica simples**: aceite com nome + data/hora + IP + dispositivo +
snapshot do que foi aceito. Válida como manifestação de vontade pela **MP 2.200-2/2001**
quando as partes aceitam o meio; ótima como comprovante em disputa. **Não** é assinatura
qualificada ICP-Brasil — e para voucher/ingresso não precisa ser.

## Segurança / multi-tenant

- `organizationId` em toda query (projeto **não** usa RLS/Supabase).
- Token de 32 bytes é o único fator de acesso à página pública — deve ser imprevisível.
  Página só expõe dados a quem tem o token.
- Assinatura é **idempotente/one-shot**: uma vez `SIGNED`, não reassina.
- Rate-limit no endpoint público de sign.

## Escopo

**Fatia 1 (este spec):** model + migration; `AcceptanceDialog` no order-sent; envio do
link; página pública; assinatura; PDF; SYSTEM msg + selo + drawer; endpoints acima.

**Fora de escopo agora (YAGNI):** OTP/SMS do assinante; geolocalização; template HSM
automático fora da janela; cadência de cobrança do aceite; assinatura desenhada a dedo;
config de termo por-org (fica hardcoded com nome da empresa + editável no diálogo);
notificação sonora (plugável depois no motor de som existente).

## Riscos

- **Janela 24h/72h (canal oficial Meta):** enviar o link é texto livre; fora da janela o
  envio falha (gate `computeWhatsappWindow`). "Pedido enviado" normalmente vem logo após
  conversa ativa (dentro da janela); em Wasender/Baileys não há limite. Se virar problema,
  HSM entra em fatia futura.
- **Ficha ausente:** se não houver `OrderFicha`, o diálogo abre com itens vazios pro
  atendente preencher do zero (não bloqueia).

## Testes

- Unit: geração de token; transição de status (PENDING→SIGNED, rejeição de reassinatura/
  expirado); montagem do snapshot; scoping por `organizationId`.
- Unit: `order-sent` estendido continua movendo o card mesmo com `withAcceptance=false`.
- Integração: fluxo público GET→sign→PDF gerado + SYSTEM msg emitida.
