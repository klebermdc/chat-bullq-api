# Atribuição de Origem de Lead (CTWA + Formulário do site)

**Data:** 2026-07-09
**Status:** Design aprovado — pronto para plano de implementação
**Branch de deploy alvo:** fork `klebermdc`, base `feat/conversation-tabs` (via PR — nunca push direto)

## Problema

Hoje não sabemos de onde um lead veio. Com o número oficial (Meta Cloud API) prestes
a ligar, passamos a ter acesso a um dado que o Baileys/Zappfy não entrega: a atribuição
de origem. Queremos:

1. Capturar automaticamente quando um lead vem de anúncio **Click-to-WhatsApp (CTWA)**.
2. Capturar quando um lead vem do **formulário do site (Elementor)**.
3. Ver de bater o olho (selo na conversa e na lista de Contatos) e medir (card no dashboard).

Deixar a estrutura 100% pronta ANTES do número ligar: o CTWA só valida de verdade quando
o número existir, mas todo o resto (schema, resolver, webhook Elementor, selo, gráfico)
é construível e testável já.

## Decisões (fechadas no brainstorming)

1. **Modelo:** colunas dedicadas em `Conversation` (`source` + `sourceDetail`), indexáveis —
   não guardar só em `metadata` Json. Casa com os Relatórios de leads existentes.
2. **Site:** Elementor Submissions → webhook dedicado que pré-marca o lead (`LeadIntake`)
   ANTES da mensagem; casamento por telefone no momento em que o WhatsApp chega.
3. **Camada visível agora:** selo (conversa + contatos) **e** card "Leads por origem" no dashboard.

## Arquitetura

```
                    ┌─────────────────────────┐
 CTWA (anúncio) ───▶│  referral na 1ª msg      │──┐
                    └─────────────────────────┘  │
                                                  ▼
 Form do site ────▶ Webhook Elementor ──▶ LeadIntake ──▶  AttributionService
 (Submissions)      (endpoint dedicado)   (pendente)      (resolve na criação
                                                           da conversa nova)
                                                  │
                                                  ▼
                              Conversation.source + sourceDetail
                              Contact.source (first-touch)
                                                  │
                                                  ▼
                     Selo (conversa + contatos) + card "Leads por origem"
```

### Regra de prioridade (roda SÓ na criação de conversa nova, `isNew`)

1. Mensagem inbound tem `referral`? → **CTWA** (detail: adId, campanha, ctwaClid…).
2. Senão, existe `LeadIntake` pendente casando `organizationId` + telefone normalizado
   dentro da janela (30 dias)? → **SITE_FORM** (detail: página, UTM); marca `consumedAt`.
3. Senão → **ORGANIC**.

Conversa **reaberta** mantém a origem original (não re-atribui).
`Contact.source` recebe valor apenas na primeira vez (first-touch estável para a lista).

## Modelo de dados (migration aditiva — sem backfill)

```prisma
enum ConversationSource {
  CTWA
  SITE_FORM
  ORGANIC
}

// Conversation:
//   + source        ConversationSource?
//   + sourceDetail  Json?
//
// Contact:
//   + source        ConversationSource?   // first-touch
//   @@index([organizationId, source])     // filtro na lista de contatos / relatórios

model LeadIntake {
  id                     String              @id @default(cuid())
  organizationId         String              @map("organization_id")
  phoneNormalized        String              @map("phone_normalized") // E.164 só dígitos
  name                   String?
  source                 ConversationSource                          // SITE_FORM
  sourceDetail           Json                @default("{}") @map("source_detail")
  consumedAt             DateTime?           @map("consumed_at")
  consumedConversationId String?             @map("consumed_conversation_id")
  createdAt              DateTime            @default(now()) @map("created_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId, phoneNormalized, consumedAt], name: "idx_leadintake_match")
  @@map("lead_intakes")
}
```

### Formato de `sourceDetail`

- **CTWA:** `{ sourceType: 'ad' | 'post', adId, sourceUrl, headline, body, ctwaClid }`
  (campos vindos de `message.referral` da Cloud API — permite cruzar com o Gerenciador de Anúncios).
- **SITE_FORM:** `{ page, formName, utmSource, utmMedium, utmCampaign }`.

## Captura — dois caminhos

### CTWA (código pronto agora; valida quando o número ligar)

- `NormalizedInboundMessage` (`ports/types/normalized-message.types.ts`) ganha campo opcional
  `referral?: InboundReferral`.
- `whatsapp-official.message-mapper.ts` preenche `referral` a partir de `message.referral`
  (topo da mensagem na Cloud API — não em `context`). Campos: `source_url`, `source_id`,
  `source_type`, `headline`, `body`, `ctwa_clid`.
- Nenhum outro adapter é afetado (campo opcional). Contatos antigos **não** têm origem
  retroativa — limitação do próprio WhatsApp; documentar no PR.

### Elementor Submissions (construível e testável já)

- Endpoint dedicado `POST /webhooks/lead-intake/:organizationId`, protegido por **secret
  por org** no header/query (mesmo padrão do webhook Wasender existente).
- Body tolerante mapeando campos do form do Elementor: telefone (obrigatório), nome,
  e campos ocultos `page` / `utm_*`.
- Cria um `LeadIntake` pendente (`source = SITE_FORM`). Sem criar conversa/contato ainda —
  a atribuição acontece quando o WhatsApp chega.
- **Configuração no Elementor:** ação "Webhook" no Submissions aponta para a URL; incluir
  no form campos ocultos com a página e UTMs.

### Normalização de telefone (risco nº 1)

Elementor manda texto livre; WhatsApp manda E.164. Centralizar um normalizador BR
(remove não-dígitos, força DDI `55`, trata 9º dígito) reusado pelos dois lados.
Casamento primário por igualdade do normalizado; **fallback por sufixo** (últimos 8–10
dígitos) como rede de segurança para divergência de 9º dígito. Reusar util existente
se houver; senão criar em local compartilhado com testes.

## Ponto de injeção no código

- `inbound-message.processor.ts:~179` chama `conversationResolver.resolve(...)`.
  Passar a `NormalizedInboundMessage` (ou `{ referral, contactPhone }`) adiante.
- `conversation-resolver.service.ts` — no ramo de criação (`tx.conversation.create`, ~L93),
  chamar `AttributionService.resolveSource({ organizationId, referral, contactPhone })`
  DENTRO da mesma transação e gravar `source` + `sourceDetail`; se `LeadIntake` casou,
  marcar `consumedAt` + `consumedConversationId` na mesma tx; carimbar `Contact.source`
  se ainda null.
- Reabertura (ramo `lastClosed`) **não** re-atribui.

### AttributionService (nova unidade, testável isolada)

- Entrada: `{ organizationId, referral?, contactPhone? }` + client de tx.
- Saída: `{ source, sourceDetail, matchedLeadIntakeId? }`.
- Responsabilidade única: aplicar a regra de prioridade. Sem I/O de UI, sem realtime.

## Camada visível (web)

- **Selo de origem** — pill no padrão dos selos 🔥/✓ existentes:
  - `CTWA` → "Anúncio" (roxo; tooltip com campanha/adId).
  - `SITE_FORM` → "Site" (tooltip com a página).
  - `ORGANIC` → "Orgânico" (neutro).
  - Locais: header da conversa **e** linha da lista de Contatos.
- **Card "Leads por origem"** nos Relatórios de leads existentes: donut + série temporal,
  com filtro por origem. Reusar o padrão do report client / envelope `{ data, meta }`.

## Testes

- **Unit (agora):**
  - `AttributionService`: prioridade CTWA > SITE_FORM > ORGANIC; janela; consumo idempotente.
  - message-mapper: parsing de `message.referral` → `referral`.
  - normalizador de telefone: casos BR (com/sem 9, com/sem 55, texto sujo) + match por sufixo.
  - webhook lead-intake: auth (secret), upsert, rejeição sem telefone.
- **E2E (agora):** fluxo formulário do site ponta a ponta (simulável sem o número).
- **E2E (depois):** CTWA real quando o número oficial ligar.

## Rollout

- Migration aditiva, **sem backfill** (origem não é recuperável retroativamente).
- Sem novas env vars obrigatórias além do secret do webhook por org (guardado no registro do
  canal/org, não em env global).
- PR no fork, base `feat/conversation-tabs`. Buildar trial (schema) antes do push.
- Pós-deploy: configurar a ação Webhook no Elementor + campos ocultos de página/UTM.

## Fora de escopo (YAGNI)

- Atribuição retroativa de contatos antigos.
- Multi-touch / atribuição de decaimento.
- Referral de anúncio do Instagram (`ReplyContext.ad` já existe — extensão natural futura).
