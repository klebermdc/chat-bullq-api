# Spec — Sistema de Templates WhatsApp (criar → submeter → aprovar → usar)

Data: 2026-07-06
Branch alvo: `feat/whatsapp-templates` (worktree; api + web)

## Objetivo
Gerenciar Message Templates (HSM) do WhatsApp Cloud API dentro do ofpchat: **criar** (builder completo), **submeter** à Meta, **acompanhar** o status de aprovação (tempo real via webhook + reconciliação), e **usar** os aprovados no envio (Inbox e recuperação de vendas).

Escopo definido com o usuário:
- Fluxo **completo**: criar + submeter + acompanhar.
- Builder **completo**: cabeçalho (texto/mídia) + corpo + rodapé + botões.
- Uso **completo**: gestão + Inbox + recuperação.
- Categorias: **MARKETING + UTILITY** (AUTHENTICATION fora do MVP).
- Templates são **por canal WHATSAPP_OFFICIAL** (cada WABA tem os seus).

## Arquitetura
Banco = fonte da verdade local; a Meta aprova. Sincronização por **webhook** (`message_template_status_update`) + botão **Sincronizar** (GET reconciliação). Tudo escopado por `organizationId` + `channelId`.

### Estado do template (lifecycle)
`DRAFT` (só local) → `PENDING` (após submeter à Meta) → `APPROVED` | `REJECTED` | `PAUSED` | `DISABLED`.
- DRAFT: editável livremente, ainda não foi pra Meta.
- PENDING: aguardando revisão (edição bloqueada).
- REJECTED: guarda `rejectionReason`; pode editar e re-submeter.
- APPROVED: usável no envio; edição dispara nova revisão (fora do MVP — editar aprovado = criar nova versão depois).

## 1. Dados — model `MessageTemplate` (Prisma)
```prisma
model MessageTemplate {
  id               String    @id @default(cuid())
  organizationId   String    @map("organization_id")
  channelId        String    @map("channel_id")
  name             String    // slug Meta: [a-z0-9_], único por WABA
  displayName      String?   @map("display_name")
  category         String    // MARKETING | UTILITY
  language         String    @default("pt_BR")
  status           String    @default("DRAFT") // DRAFT|PENDING|APPROVED|REJECTED|PAUSED|DISABLED
  components       Json      // { header?, body, footer?, buttons? } (formato interno normalizado)
  variableExamples Json      @default("{}") @map("variable_examples") // exemplos exigidos pela Meta
  metaTemplateId   String?   @unique @map("meta_template_id")
  rejectionReason  String?   @map("rejection_reason")
  createdAt        DateTime  @default(now()) @map("created_at")
  updatedAt        DateTime  @updatedAt @map("updated_at")
  submittedAt      DateTime? @map("submitted_at")
  reviewedAt       DateTime? @map("reviewed_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  channel      Channel      @relation(fields: [channelId], references: [id], onDelete: Cascade)

  @@unique([channelId, name])
  @@index([organizationId, status])
  @@map("message_templates")
}
```
Relations reversas em `Organization` e `Channel`. Migration Prisma.

### Formato interno de `components`
```ts
{
  header?: { format: 'TEXT'|'IMAGE'|'VIDEO'|'DOCUMENT', text?: string, example?: {...} },
  body:    { text: string, variables: number },           // {{1}}..{{n}}
  footer?: { text: string },
  buttons?: Array<
    | { type: 'QUICK_REPLY', text: string }
    | { type: 'URL', text: string, url: string, example?: string }
    | { type: 'PHONE_NUMBER', text: string, phone: string }
  >
}
```
Um **mapper** converte isso ⇄ payload `components` da Graph API (com `example.body_text`, `example.header_handle` etc).

## 2. Backend — módulo `message-templates`
- **http-client** (estende `whatsapp-official.http-client.ts`):
  - `createTemplate(channel, payload)` → POST `/{WABA}/message_templates`
  - `listTemplates(channel)` → GET `/{WABA}/message_templates?fields=name,status,category,language,components,id`
  - `deleteTemplate(channel, name)` → DELETE `/{WABA}/message_templates?name=`
  - `uploadHeaderSample(channel, file)` → upload resumável p/ handle (só header de mídia)
- **TemplatesService:** `create` (DRAFT), `update` (só DRAFT/REJECTED), `submit` (valida → POST Meta → PENDING + `metaTemplateId`), `sync` (GET Meta → reconcilia status), `remove`.
- **TemplatesController** (escopo por canal, Roles OWNER/ADMIN):
  - `GET /channels/:channelId/message-templates`
  - `POST /channels/:channelId/message-templates` (cria DRAFT)
  - `PATCH .../:id`
  - `POST .../:id/submit`
  - `POST /channels/:channelId/message-templates/sync`
  - `DELETE .../:id`
- **Validação:** nome (`^[a-z0-9_]+$`, único por canal), exemplos obrigatórios p/ cada variável, categoria válida, canal precisa ser WHATSAPP_OFFICIAL com `businessAccountId`.

## 3. Webhook — status de aprovação
Estender `whatsapp-official.inbound-adapter.ts::parseWebhook` para tratar `field === 'message_template_status_update'`:
- extrair `message_template_id`, `event`/`status`, `reason`.
- novo campo `templateStatusUpdates[]` em `WebhookParseResult`.
- `webhook-gateway.controller.ts` aplica: `MessageTemplate.updateByMetaId(metaTemplateId, { status, rejectionReason, reviewedAt })`.
- Emitir WebSocket p/ a tela de templates atualizar o badge em tempo real.

## 4. Frontend (chat-bullq-web — espelhar `quick-replies`)
- **Tela Templates** em `settings/templates` (feature `features/templates`): seletor de canal oficial; lista com **badge de status** (Rascunho/Pendente/Aprovado/Rejeitado + motivo); ações submeter/sincronizar/excluir.
- **Builder (dialog):** nome + categoria + idioma; **cabeçalho** (nenhum/texto/mídia com upload de exemplo); **corpo** com botão "inserir variável" (`{{n}}`) e campos de **exemplo** por variável; **rodapé**; **botões** (resposta rápida / URL / ligar); **preview ao vivo** estilo WhatsApp.
- **Inbox:** no compositor, botão "Template" → lista só **APPROVED** do canal da conversa → preenche variáveis → envia (cria `Message type=TEMPLATE`, pipeline existente entrega).
- **Recuperação:** em `sales-recovery`, trocar `RECOVERY_OPENER_TEMPLATE_NAME` (env) por um **select** de template aprovado do banco; `buildTemplate` passa a montar `parameters` a partir do template escolhido + valores em runtime.

## 5. Fases de entrega (independentes)
1. **Núcleo:** model + migration + http-client + service/controller + webhook status + tela de gestão + builder. → entrega criar/submeter/acompanhar.
2. **Inbox:** seletor de template no compositor + envio com variáveis.
3. **Recuperação:** trocar env var por template do banco.

## 6. Pegadinhas (tratadas no design)
- Nome do template: `[a-z0-9_]`, único por WABA; a Meta rejeita fora do padrão.
- **Exemplos obrigatórios**: sem sample das variáveis a Meta reprova na hora.
- **Cabeçalho de mídia**: exige subir um *handle* de exemplo (upload resumável em 2 passos) — último item da Fase 1.
- Edição pós-submit é limitada (PENDING não edita; MVP não trata edição de APPROVED).
- **Sync fallback:** o webhook pode falhar/atrasar → botão Sincronizar cobre.
- Só canais WHATSAPP_OFFICIAL com `businessAccountId` têm templates — a UI filtra.

## 7. Fora do escopo (MVP)
- Templates AUTHENTICATION (OTP).
- Edição/versionamento de template já APROVADO.
- Botões COPY_CODE / catálogo / flows.
