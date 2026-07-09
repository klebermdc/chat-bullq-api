# Atribuição de Origem de Lead — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Carimbar a origem de cada conversa (anúncio Click-to-WhatsApp, formulário do site via Elementor, ou orgânico), exibir como selo na conversa/contatos e medir num card "Leads por origem" no dashboard.

**Architecture:** Colunas dedicadas em `Conversation` (`source` + `sourceDetail`) e `Contact` (`source`, first-touch). Um `AttributionService` resolve a origem no momento em que uma conversa nova nasce, com prioridade CTWA (referral na msg) > SITE_FORM (casamento de um `LeadIntake` pré-criado por webhook do Elementor, por telefone) > ORGANIC. Camada visível reusa o padrão de selos e o módulo dashboard existentes.

**Tech Stack:** NestJS + Prisma (PostgreSQL) + BullMQ na API; Next.js + React Query no web. Testes com Jest.

**Spec:** `docs/superpowers/specs/2026-07-09-lead-source-attribution-design.md`

**Depende de:** feature **Meta CAPI + CTWA** (`feat/meta-capi-ctwa`, PR fork API #27) — que JÁ entregou: o tipo `InboundReferral = { ctwaClid?, sourceId?, sourceType? }` em `normalized-message.types.ts`, o parse de `message.referral` no mapper oficial, e as colunas `Contact.ctwaClid/ctwaSourceId/ctwaSourceType/ctwaClidAt` gravadas no `contact-resolver`. **Este plano REUSA tudo isso — não recria.** A captura CTWA já existe; aqui só classificamos (`Conversation.source`), adicionamos o lado do site (Elementor/LeadIntake) e a UI.

**Base/branch:** nova worktree/branch a partir de `feat/meta-capi-ctwa` (fork `klebermdc`), para empilhar sobre o referral já capturado. PR base = `feat/meta-capi-ctwa` (ou `feat/conversation-tabs` depois que o #27 mergear). **Gotcha da worktree:** node_modules não é copiado → `ln -s ../../node_modules node_modules` na raiz da worktree pra o jest rodar. Migration aditiva, sem backfill.

---

## Estrutura de arquivos

**Criar:**
- `src/modules/lead-intake/lead-intake.module.ts` — módulo do webhook Elementor
- `src/modules/lead-intake/lead-intake.controller.ts` — endpoint público `POST /webhooks/lead-intake/:organizationId`
- `src/modules/lead-intake/lead-intake.service.ts` — cria `LeadIntake`; valida secret
- `src/modules/lead-intake/dto/create-lead-intake.dto.ts` — payload do form
- `src/modules/lead-intake/lead-intake.service.spec.ts`
- `src/modules/messaging/pipeline/attribution.service.ts` — resolve a origem (regra de prioridade)
- `src/modules/messaging/pipeline/attribution.service.spec.ts`

**Modificar:**
- `prisma/schema.prisma` — enum `ConversationSource`; `Conversation.source/sourceDetail`; `Contact.source` + index; `LeadIntake`; `Organization.leadIntakeSecret` (o `Contact` já tem as colunas `ctwa*` do meta-capi — não mexer nelas)
- `src/common/utils/phone.util.ts` (+ `.spec.ts`) — helper de casamento por sufixo
- `src/modules/messaging/pipeline/conversation-resolver.service.ts` — carimbar origem na criação

**Reusado do meta-capi (NÃO tocar):** `InboundReferral` + `referral?` em `normalized-message.types.ts`; parse de `message.referral` no `whatsapp-official.message-mapper.ts`; colunas `Contact.ctwa*`.
- `src/modules/messaging/pipeline/inbound-message.processor.ts` — passar `referral`+`contactPhone` ao resolver
- `src/modules/messaging/messaging.module.ts` — registrar `AttributionService`
- `src/modules/dashboard/dashboard.service.ts` / `dashboard.controller.ts` — endpoint `leads-by-source`
- `src/app.module.ts` — registrar `LeadIntakeModule`

**Web (chat-bullq-web):**
- `src/features/inbox/components/source-badge.tsx` — selo de origem (criar)
- header da conversa + linha da lista de contatos — inserir o selo
- `src/features/dashboard/services/dashboard.service.ts` + card "Leads por origem"

---

## Task 1: Schema — enum, colunas, LeadIntake, secret da org

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Adicionar o enum `ConversationSource`**

No bloco de enums do `prisma/schema.prisma` (perto dos outros `enum`), adicionar:

```prisma
enum ConversationSource {
  CTWA
  SITE_FORM
  ORGANIC
}
```

- [ ] **Step 2: Adicionar colunas em `Conversation`**

No `model Conversation`, junto do bloco `metadata Json @default("{}")`, adicionar:

```prisma
  // Origem do lead (atribuição). Setado uma vez, na criação da conversa.
  source       ConversationSource? @map("source")
  sourceDetail Json?               @map("source_detail")
```

- [ ] **Step 3: Adicionar coluna + index em `Contact`**

No `model Contact`, após `notes String?`, adicionar:

```prisma
  // First-touch: origem da PRIMEIRA conversa atribuída deste contato.
  source ConversationSource? @map("source")
```

E no bloco de índices do `Contact` (junto dos `@@index` existentes), adicionar:

```prisma
  @@index([organizationId, source], name: "idx_contact_org_source")
```

- [ ] **Step 4: Adicionar `leadIntakeSecret` em `Organization`**

No `model Organization`, junto dos campos escalares, adicionar:

```prisma
  // Secret do webhook público de entrada de lead (Elementor). null = desativado.
  leadIntakeSecret String? @map("lead_intake_secret")
```

E adicionar a relação inversa (junto das outras relations do `Organization`):

```prisma
  leadIntakes LeadIntake[]
```

- [ ] **Step 5: Adicionar o model `LeadIntake`**

Após o `model Contact` (ou junto dos models de messaging), adicionar:

```prisma
model LeadIntake {
  id                     String             @id @default(cuid())
  organizationId         String             @map("organization_id")
  phoneNormalized        String             @map("phone_normalized")
  name                   String?
  source                 ConversationSource
  sourceDetail           Json               @default("{}") @map("source_detail")
  consumedAt             DateTime?          @map("consumed_at")
  consumedConversationId String?            @map("consumed_conversation_id")
  createdAt              DateTime           @default(now()) @map("created_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId, phoneNormalized, consumedAt], name: "idx_leadintake_match")
  @@map("lead_intakes")
}
```

- [ ] **Step 6: Validar o schema (NÃO rodar `prisma format`)**

Run: `npx prisma validate`
Expected: "The schema is valid". **Não** rodar `npx prisma format` — ele reflowa o arquivo inteiro e causa a pegadinha de merge do `schema.prisma` (visto no meta-capi e no whatsapp-templates). Formatar à mão só o bloco adicionado e conferir que os models vizinhos (`Contact`, `Organization`, `Conversation`) continuam fechados com `}`.

- [ ] **Step 7: Criar a migration**

Run: `npx prisma migrate dev --name lead_source_attribution --create-only`
Expected: cria `prisma/migrations/<timestamp>_lead_source_attribution/migration.sql`. Abrir o arquivo e conferir que só há `CREATE TYPE`, `ALTER TABLE ... ADD COLUMN`, `CREATE TABLE lead_intakes`, `CREATE INDEX` — nenhum `DROP`.

- [ ] **Step 8: Aplicar e gerar client**

Run: `npx prisma migrate dev --name lead_source_attribution && npx prisma generate`
Expected: migration aplicada; `@prisma/client` regenerado com `ConversationSource` e `LeadIntake`.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): origem de lead — ConversationSource, colunas source, LeadIntake"
```

---

## Task 2: Helper de casamento de telefone por sufixo

`normalizePhone` já existe em `src/common/utils/phone.util.ts`. Adicionamos um helper que devolve o sufixo usado no casamento do `LeadIntake` (rede de segurança para divergência de 9º dígito entre o texto do Elementor e o E.164 do WhatsApp).

**Files:**
- Modify: `src/common/utils/phone.util.ts`
- Test: `src/common/utils/phone.util.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `src/common/utils/phone.util.spec.ts`:

```typescript
import { normalizePhone, phoneMatchSuffix } from './phone.util';

describe('phoneMatchSuffix', () => {
  it('devolve os últimos 10 dígitos do telefone normalizado', () => {
    expect(phoneMatchSuffix(normalizePhone('+55 (11) 98201-5967'))).toBe('1198201597'.slice(-10));
  });

  it('casa E.164 (com 55) e número digitado sem DDI pelo mesmo sufixo', () => {
    const fromWhatsapp = normalizePhone('5511982015967'); // 13 dígitos
    const fromForm = normalizePhone('11982015967'); // 11 dígitos, sem DDI
    expect(phoneMatchSuffix(fromWhatsapp)).toBe(phoneMatchSuffix(fromForm));
  });

  it('devolve a string inteira quando tem menos de 10 dígitos', () => {
    expect(phoneMatchSuffix('12345678')).toBe('12345678');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/common/utils/phone.util.spec.ts`
Expected: FAIL — `phoneMatchSuffix is not a function`.

- [ ] **Step 3: Implementar**

Adicionar ao fim de `src/common/utils/phone.util.ts`:

```typescript
/**
 * Sufixo usado para casar um lead do formulário (texto livre) com o telefone
 * do WhatsApp (E.164). Usa os últimos 10 dígitos para absorver divergência de
 * DDI/9º dígito. Tradeoff aceito: números muito parecidos podem colidir.
 */
export function phoneMatchSuffix(normalized: string): string {
  return normalized.length > 10 ? normalized.slice(-10) : normalized;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/common/utils/phone.util.spec.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/common/utils/phone.util.ts src/common/utils/phone.util.spec.ts
git commit -m "feat(phone): phoneMatchSuffix para casar lead do form com WhatsApp"
```

---

## Task 3: (Herdado do meta-capi) Verificar a captura do referral CTWA

Nada a implementar — o meta-capi (`feat/meta-capi-ctwa`) já entregou o tipo `InboundReferral` e o parse de `message.referral` no mapper oficial. Este task é só a confirmação de que a base tem o que a atribuição precisa.

**Files:** nenhum (verificação).

- [ ] **Step 1: Confirmar o tipo e o parse na base**

Run:
```bash
grep -n "export interface InboundReferral" src/modules/channel-hub/ports/types/normalized-message.types.ts
grep -n "referral" src/modules/channel-hub/adapters/whatsapp-official/whatsapp-official.message-mapper.ts
```
Expected: `InboundReferral` existe com `{ ctwaClid?, sourceId?, sourceType? }` e o mapper preenche `result.referral` a partir de `message.referral`.

> Se por algum motivo a base NÃO tiver isso (ex.: começou de `feat/conversation-tabs` antes do #27 mergear), PARE e volte à decisão de base — este plano assume o referral já capturado. A atribuição (Task 4) consome exatamente esses três campos; nada além é necessário.

- [ ] **Step 2: Confirmar que `NormalizedInboundMessage.referral` chega ao processor**

Run: `grep -n "referral" src/modules/messaging/pipeline/contact-resolver.service.ts`
Expected: `buildCtwaData` lê `message.referral` — confirma que o campo está populado no pipeline e disponível para passarmos ao `conversation-resolver` no Task 5.

---

## Task 4: AttributionService (regra de prioridade)

Serviço puro de decisão. Recebe um Prisma transaction client, o referral e o telefone; devolve `{ source, sourceDetail, matchedLeadIntakeId }`. NÃO escreve nada — quem escreve é o resolver (dono da transação e do `conversationId`).

**Files:**
- Create: `src/modules/messaging/pipeline/attribution.service.ts`
- Test: `src/modules/messaging/pipeline/attribution.service.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/modules/messaging/pipeline/attribution.service.spec.ts`:

```typescript
import { ConversationSource } from '@prisma/client';
import { AttributionService } from './attribution.service';

describe('AttributionService', () => {
  const service = new AttributionService();

  function txWith(leadIntake: any) {
    return {
      leadIntake: { findFirst: jest.fn().mockResolvedValue(leadIntake) },
    } as any;
  }

  it('prioriza CTWA quando há referral, sem consultar LeadIntake', async () => {
    const tx = txWith(null);
    const out = await service.resolveSource(tx, {
      organizationId: 'org1',
      contactPhone: '5511999999999',
      referral: { sourceType: 'ad', sourceId: '120', ctwaClid: 'clid-abc' },
    });
    expect(out.source).toBe(ConversationSource.CTWA);
    expect(out.sourceDetail).toMatchObject({ sourceType: 'ad', adId: '120', ctwaClid: 'clid-abc' });
    expect(out.matchedLeadIntakeId).toBeNull();
    expect(tx.leadIntake.findFirst).not.toHaveBeenCalled();
  });

  it('casa SITE_FORM por sufixo de telefone quando não há referral', async () => {
    const tx = txWith({
      id: 'li1',
      source: ConversationSource.SITE_FORM,
      sourceDetail: { page: '/orcamento', utmSource: 'google' },
    });
    const out = await service.resolveSource(tx, {
      organizationId: 'org1',
      contactPhone: '5511982015967',
    });
    expect(out.source).toBe(ConversationSource.SITE_FORM);
    expect(out.sourceDetail).toMatchObject({ page: '/orcamento', utmSource: 'google' });
    expect(out.matchedLeadIntakeId).toBe('li1');
    expect(tx.leadIntake.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'org1', consumedAt: null }),
      }),
    );
  });

  it('cai para ORGANIC quando não há referral nem LeadIntake', async () => {
    const tx = txWith(null);
    const out = await service.resolveSource(tx, {
      organizationId: 'org1',
      contactPhone: '5511982015967',
    });
    expect(out.source).toBe(ConversationSource.ORGANIC);
    expect(out.matchedLeadIntakeId).toBeNull();
  });

  it('é ORGANIC quando não há telefone para casar', async () => {
    const tx = txWith(null);
    const out = await service.resolveSource(tx, { organizationId: 'org1' });
    expect(out.source).toBe(ConversationSource.ORGANIC);
    expect(tx.leadIntake.findFirst).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/messaging/pipeline/attribution.service.spec.ts`
Expected: FAIL — `Cannot find module './attribution.service'`.

- [ ] **Step 3: Implementar**

Criar `src/modules/messaging/pipeline/attribution.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { ConversationSource, Prisma } from '@prisma/client';
import { normalizePhone, phoneMatchSuffix } from '../../../common/utils/phone.util';
import { InboundReferral } from '../../channel-hub/ports/types';

export interface AttributionInput {
  organizationId: string;
  referral?: InboundReferral;
  contactPhone?: string;
}

export interface AttributionResult {
  source: ConversationSource;
  sourceDetail: Prisma.JsonObject;
  matchedLeadIntakeId: string | null;
}

@Injectable()
export class AttributionService {
  /**
   * Resolve a origem de uma conversa NOVA. Prioridade:
   *   1) referral (CTWA)  2) LeadIntake pendente casando telefone  3) ORGANIC.
   * Só lê — a escrita (consumir o LeadIntake, criar a conversa) é do resolver.
   */
  async resolveSource(
    tx: Prisma.TransactionClient,
    input: AttributionInput,
  ): Promise<AttributionResult> {
    // CTWA: o referral só existe na 1ª msg pós-clique. Basta ctwaClid OU sourceId
    // presente para considerar origem de anúncio (campos vindos do meta-capi).
    if (input.referral && (input.referral.ctwaClid || input.referral.sourceId)) {
      const r = input.referral;
      return {
        source: ConversationSource.CTWA,
        sourceDetail: {
          sourceType: r.sourceType ?? null,
          adId: r.sourceId ?? null,
          ctwaClid: r.ctwaClid ?? null,
        },
        matchedLeadIntakeId: null,
      };
    }

    if (input.contactPhone) {
      let suffix: string | null = null;
      try {
        suffix = phoneMatchSuffix(normalizePhone(input.contactPhone));
      } catch {
        suffix = null; // telefone impróprio → sem casamento
      }
      if (suffix) {
        const WINDOW_DAYS = 30;
        const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const li = await tx.leadIntake.findFirst({
          where: {
            organizationId: input.organizationId,
            consumedAt: null,
            createdAt: { gte: since },
            phoneNormalized: { endsWith: suffix },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (li) {
          return {
            source: li.source,
            sourceDetail: (li.sourceDetail as Prisma.JsonObject) ?? {},
            matchedLeadIntakeId: li.id,
          };
        }
      }
    }

    return { source: ConversationSource.ORGANIC, sourceDetail: {}, matchedLeadIntakeId: null };
  }
}
```

> Nota: `Date.now()` aqui é código de produção normal (não é o ambiente do Workflow) — ok usar.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/messaging/pipeline/attribution.service.spec.ts`
Expected: PASS (4 testes).

- [ ] **Step 5: Exportar `InboundReferral` no barrel de ports**

Conferir que `src/modules/channel-hub/ports/types/index.ts` re-exporta os tipos de `normalized-message.types`. Se ele usa `export * from './normalized-message.types';`, nada a fazer. Rodar:

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i attribution || echo OK`
Expected: `OK` (sem erro de import).

- [ ] **Step 6: Commit**

```bash
git add src/modules/messaging/pipeline/attribution.service.ts src/modules/messaging/pipeline/attribution.service.spec.ts
git commit -m "feat(attribution): AttributionService com prioridade CTWA > SITE_FORM > ORGANIC"
```

---

## Task 5: Carimbar a origem na criação da conversa

Threadar `referral` + `contactPhone` do processor até o resolver e, no ramo de criação (só `isNew`), gravar `source`/`sourceDetail`, consumir o `LeadIntake` e carimbar `Contact.source` (first-touch).

**Files:**
- Modify: `src/modules/messaging/pipeline/conversation-resolver.service.ts`
- Modify: `src/modules/messaging/pipeline/inbound-message.processor.ts`
- Modify: `src/modules/messaging/messaging.module.ts`
- Test: `src/modules/messaging/pipeline/conversation-resolver.service.spec.ts` (se existir; senão criar)

- [ ] **Step 1: Registrar `AttributionService` no módulo**

Em `messaging.module.ts`, adicionar `AttributionService` ao array `providers` e importar no topo:

```typescript
import { AttributionService } from './pipeline/attribution.service';
// ...
  providers: [
    // ...existentes...
    AttributionService,
  ],
```

- [ ] **Step 2: Injetar `AttributionService` no resolver e estender a assinatura de `resolve`**

Em `conversation-resolver.service.ts`, adicionar ao construtor (junto dos deps existentes) e importar:

```typescript
import { AttributionService } from './attribution.service';
import { InboundReferral } from '../../channel-hub/ports/types';
// no constructor:
    private readonly attribution: AttributionService,
```

Mudar a assinatura de `resolve`:

```typescript
  async resolve(
    organizationId: string,
    channelId: string,
    contactId: string,
    isGroup?: boolean,
    attributionInput?: { referral?: InboundReferral; contactPhone?: string },
  ): Promise<ResolvedConversation> {
```

- [ ] **Step 3: Gravar origem dentro da transação de criação**

No ramo de criação (o `this.prisma.$transaction(async (tx) => { ... })` em ~L91), substituir o bloco que cria a conversa por:

```typescript
        const conversation = await this.prisma.$transaction(async (tx) => {
          const attribution = await this.attribution.resolveSource(tx, {
            organizationId,
            referral: attributionInput?.referral,
            contactPhone: attributionInput?.contactPhone,
          });

          const created = await tx.conversation.create({
            data: {
              organizationId,
              channelId,
              contactId,
              status: ConversationStatus.PENDING,
              protocol,
              isGroup: isGroup || false,
              source: attribution.source,
              sourceDetail: attribution.sourceDetail,
            },
          });

          if (attribution.matchedLeadIntakeId) {
            await tx.leadIntake.update({
              where: { id: attribution.matchedLeadIntakeId },
              data: { consumedAt: new Date(), consumedConversationId: created.id },
            });
          }

          // First-touch: carimba o Contact só se ainda não tiver origem.
          await tx.contact.updateMany({
            where: { id: contactId, source: null },
            data: { source: attribution.source },
          });

          await tx.conversationAuditLog.create({
            data: {
              conversationId: created.id,
              action: 'CREATED',
              toValue: ConversationStatus.PENDING,
            },
          });
          await this.outbox.enqueue(tx, AutomationTrigger.CONVERSATION_CREATED, {
            organizationId,
            contactId,
            conversationId: created.id,
            channelId,
          });
          return created;
        });
```

> Reabertura (`lastClosed`) e fast-path continuam SEM atribuição — só conversa nova é carimbada.

- [ ] **Step 4: Passar o referral+telefone no processor**

Em `inbound-message.processor.ts` (~L179), trocar a chamada:

```typescript
      const { conversationId, status } = await this.conversationResolver.resolve(
        organizationId,
        channelId,
        contactId,
        message.isGroup,
        { referral: message.referral, contactPhone: message.contactPhone },
      );
```

- [ ] **Step 5: Teste de integração do carimbo (mock de tx)**

Criar/estender `conversation-resolver.service.spec.ts` com um teste do ramo de criação que verifica que `conversation.create` recebe `source`/`sourceDetail` e que o contato é carimbado. Como o resolver usa `$transaction`, mockar `prisma.$transaction` para executar o callback com um `tx` mockado:

```typescript
it('carimba source na criação e faz first-touch no contato', async () => {
  const tx = {
    conversation: { create: jest.fn().mockResolvedValue({ id: 'c1', protocol: 'p' }) },
    leadIntake: { update: jest.fn() },
    contact: { updateMany: jest.fn() },
    conversationAuditLog: { create: jest.fn() },
  };
  (prisma.$transaction as jest.Mock).mockImplementation((cb: any) => cb(tx));
  attribution.resolveSource = jest.fn().mockResolvedValue({
    source: 'CTWA', sourceDetail: { adId: '120' }, matchedLeadIntakeId: null,
  });
  // ...arranjar findOpen/lastClosed para cair no ramo de criação...

  await service.resolve('org1', 'ch1', 'ct1', false, {
    referral: { sourceType: 'ad', sourceId: '120' },
  });

  expect(tx.conversation.create).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ source: 'CTWA', sourceDetail: { adId: '120' } }) }),
  );
  expect(tx.contact.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'ct1', source: null }, data: { source: 'CTWA' } }),
  );
});
```

> Ajustar o arranjo (`findOpen` retornando null, `lastClosed` null) conforme os mocks já usados no arquivo. Se não houver spec do resolver, seguir o padrão de mock dos outros specs em `pipeline/`.

- [ ] **Step 6: Rodar a suíte de messaging**

Run: `npx jest src/modules/messaging`
Expected: PASS (incluindo o novo teste; os existentes continuam verdes).

- [ ] **Step 7: Commit**

```bash
git add src/modules/messaging
git commit -m "feat(attribution): carimba origem na criação da conversa + first-touch no contato"
```

---

## Task 6: Webhook do Elementor (lead-intake)

Endpoint público que o Elementor Submissions chama. Valida um secret por org e cria um `LeadIntake` pendente.

**Files:**
- Create: `src/modules/lead-intake/dto/create-lead-intake.dto.ts`
- Create: `src/modules/lead-intake/lead-intake.service.ts`
- Create: `src/modules/lead-intake/lead-intake.controller.ts`
- Create: `src/modules/lead-intake/lead-intake.module.ts`
- Test: `src/modules/lead-intake/lead-intake.service.spec.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: DTO**

Criar `src/modules/lead-intake/dto/create-lead-intake.dto.ts`:

```typescript
import { IsOptional, IsString } from 'class-validator';

export class CreateLeadIntakeDto {
  @IsString()
  phone!: string;

  @IsOptional() @IsString()
  name?: string;

  @IsOptional() @IsString()
  page?: string;

  @IsOptional() @IsString()
  formName?: string;

  @IsOptional() @IsString()
  utmSource?: string;

  @IsOptional() @IsString()
  utmMedium?: string;

  @IsOptional() @IsString()
  utmCampaign?: string;
}
```

- [ ] **Step 2: Escrever o teste do service que falha**

Criar `src/modules/lead-intake/lead-intake.service.spec.ts`:

```typescript
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConversationSource } from '@prisma/client';
import { LeadIntakeService } from './lead-intake.service';

describe('LeadIntakeService', () => {
  let prisma: any;
  let service: LeadIntakeService;

  beforeEach(() => {
    prisma = {
      organization: { findUnique: jest.fn() },
      leadIntake: { create: jest.fn().mockResolvedValue({ id: 'li1' }) },
    };
    service = new LeadIntakeService(prisma);
  });

  it('rejeita secret inválido', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org1', leadIntakeSecret: 'right' });
    await expect(
      service.ingest('org1', 'wrong', { phone: '11982015967' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita quando a org não tem secret configurado', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org1', leadIntakeSecret: null });
    await expect(
      service.ingest('org1', 'x', { phone: '11982015967' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita telefone inválido', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org1', leadIntakeSecret: 's' });
    await expect(
      service.ingest('org1', 's', { phone: '123' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cria LeadIntake SITE_FORM com telefone normalizado e detalhe', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 'org1', leadIntakeSecret: 's' });
    const out = await service.ingest('org1', 's', {
      phone: '+55 (11) 98201-5967',
      name: 'Fulano',
      page: '/orcamento',
      utmSource: 'google',
    });
    expect(out).toEqual({ id: 'li1' });
    expect(prisma.leadIntake.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org1',
        phoneNormalized: '5511982015967',
        name: 'Fulano',
        source: ConversationSource.SITE_FORM,
        sourceDetail: expect.objectContaining({ page: '/orcamento', utmSource: 'google' }),
      }),
    });
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx jest src/modules/lead-intake/lead-intake.service.spec.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implementar o service**

Criar `src/modules/lead-intake/lead-intake.service.ts`:

```typescript
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConversationSource } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { normalizePhone } from '../../common/utils/phone.util';
import { CreateLeadIntakeDto } from './dto/create-lead-intake.dto';

@Injectable()
export class LeadIntakeService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(organizationId: string, secret: string | undefined, dto: CreateLeadIntakeDto) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, leadIntakeSecret: true },
    });
    if (!org || !org.leadIntakeSecret || org.leadIntakeSecret !== secret) {
      throw new UnauthorizedException('Secret inválido');
    }

    let phoneNormalized: string;
    try {
      phoneNormalized = normalizePhone(dto.phone);
    } catch {
      throw new BadRequestException('Telefone inválido');
    }

    return this.prisma.leadIntake.create({
      data: {
        organizationId,
        phoneNormalized,
        name: dto.name ?? null,
        source: ConversationSource.SITE_FORM,
        sourceDetail: {
          page: dto.page ?? null,
          formName: dto.formName ?? null,
          utmSource: dto.utmSource ?? null,
          utmMedium: dto.utmMedium ?? null,
          utmCampaign: dto.utmCampaign ?? null,
        },
      },
      select: { id: true },
    });
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx jest src/modules/lead-intake/lead-intake.service.spec.ts`
Expected: PASS (4 testes).

- [ ] **Step 6: Controller público**

Criar `src/modules/lead-intake/lead-intake.controller.ts`. O secret chega no header `x-lead-intake-secret` (ou query `?secret=` — Elementor manda ambos via config). Padrão `@Public()` de `webhook-gateway.controller.ts`:

```typescript
import { Body, Controller, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { LeadIntakeService } from './lead-intake.service';
import { CreateLeadIntakeDto } from './dto/create-lead-intake.dto';

@ApiTags('Webhooks')
@Controller('webhooks/lead-intake')
export class LeadIntakeController {
  constructor(private readonly service: LeadIntakeService) {}

  @Post(':organizationId')
  @Public()
  @HttpCode(200)
  @ApiOperation({ summary: 'Recebe lead do formulário do site (Elementor Submissions)' })
  async ingest(
    @Param('organizationId') organizationId: string,
    @Headers('x-lead-intake-secret') headerSecret: string,
    @Query('secret') querySecret: string,
    @Body() dto: CreateLeadIntakeDto,
  ) {
    await this.service.ingest(organizationId, headerSecret || querySecret, dto);
    return { ok: true };
  }
}
```

- [ ] **Step 7: Módulo + registro**

Criar `src/modules/lead-intake/lead-intake.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { LeadIntakeController } from './lead-intake.controller';
import { LeadIntakeService } from './lead-intake.service';

@Module({
  imports: [DatabaseModule],
  controllers: [LeadIntakeController],
  providers: [LeadIntakeService],
})
export class LeadIntakeModule {}
```

> Conferir o nome real do módulo que exporta `PrismaService` (provável `DatabaseModule` em `src/database/`). Se for global, `imports` pode ficar vazio.

Em `src/app.module.ts`, importar e adicionar `LeadIntakeModule` ao array `imports`.

- [ ] **Step 8: Build + suíte do módulo**

Run: `npx jest src/modules/lead-intake && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i lead-intake || echo OK`
Expected: testes PASS e `OK` (sem erro de tipos).

- [ ] **Step 9: Commit**

```bash
git add src/modules/lead-intake src/app.module.ts
git commit -m "feat(lead-intake): webhook público do Elementor cria LeadIntake"
```

---

## Task 7: Endpoint autenticado para gerar/rotacionar o secret

Admin precisa obter a URL+secret para colar no Elementor. Endpoint simples sob `dashboard` ou `channels`. Aqui: um sub-recurso em `dashboard` (já é OWNER/ADMIN-guarded onde precisa) — mas como isso muda config sensível, exigimos `@Roles(OWNER, ADMIN)`.

**Files:**
- Modify: `src/modules/lead-intake/lead-intake.service.ts`
- Create: `src/modules/lead-intake/lead-intake-admin.controller.ts`
- Modify: `src/modules/lead-intake/lead-intake.module.ts`

- [ ] **Step 1: Método de rotação no service**

Adicionar em `LeadIntakeService`:

```typescript
import { randomBytes } from 'crypto';
// ...
  async rotateSecret(organizationId: string): Promise<{ secret: string }> {
    const secret = randomBytes(24).toString('hex');
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { leadIntakeSecret: secret },
    });
    return { secret };
  }

  async getConfig(organizationId: string): Promise<{ configured: boolean }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { leadIntakeSecret: true },
    });
    return { configured: !!org?.leadIntakeSecret };
  }
```

- [ ] **Step 2: Controller admin**

Criar `src/modules/lead-intake/lead-intake-admin.controller.ts` (seguir os guards/decorators de `dashboard.controller.ts`):

```typescript
import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, Roles } from '../../common/decorators';
import { LeadIntakeService } from './lead-intake.service';

@ApiTags('Lead Intake')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Roles(OrgRole.OWNER, OrgRole.ADMIN)
@Controller('lead-intake')
export class LeadIntakeAdminController {
  constructor(private readonly service: LeadIntakeService) {}

  @Get('config')
  @ApiOperation({ summary: 'Status do webhook de entrada de lead' })
  getConfig(@CurrentOrg('id') orgId: string) {
    return this.service.getConfig(orgId);
  }

  @Post('secret/rotate')
  @ApiOperation({ summary: 'Gera/rotaciona o secret do webhook (retorna uma vez)' })
  rotate(@CurrentOrg('id') orgId: string) {
    return this.service.rotateSecret(orgId);
  }
}
```

> Conferir os nomes reais dos guards/decorators (`Roles`, `CurrentOrg`, `RolesGuard`) em `dashboard.controller.ts` — usar exatamente os mesmos imports.

- [ ] **Step 3: Registrar o controller**

Em `lead-intake.module.ts`, adicionar `LeadIntakeAdminController` ao array `controllers`.

- [ ] **Step 4: Build**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i lead-intake || echo OK`
Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/lead-intake
git commit -m "feat(lead-intake): endpoint admin para gerar/rotacionar secret do webhook"
```

---

## Task 8: Endpoint de dashboard "Leads por origem"

**Files:**
- Modify: `src/modules/dashboard/dashboard.service.ts`
- Modify: `src/modules/dashboard/dashboard.controller.ts`
- Test: `src/modules/dashboard/dashboard.service.spec.ts` (se existir; senão criar mínimo)

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `dashboard.service.spec.ts` (ou criar seguindo o padrão dos specs existentes de dashboard):

```typescript
it('getLeadsBySource agrupa conversas por source no range e escopo', async () => {
  (prisma.conversation.groupBy as jest.Mock).mockResolvedValue([
    { source: 'CTWA', _count: { _all: 5 } },
    { source: 'SITE_FORM', _count: { _all: 3 } },
    { source: null, _count: { _all: 2 } },
  ]);
  const out = await service.getLeadsBySource('org1', { from: new Date('2026-07-01'), to: new Date('2026-07-09') }, undefined);
  expect(out).toEqual([
    { source: 'CTWA', count: 5 },
    { source: 'SITE_FORM', count: 3 },
    { source: 'ORGANIC', count: 2 },
  ]);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/dashboard/dashboard.service.spec.ts -t getLeadsBySource`
Expected: FAIL — `getLeadsBySource is not a function`.

- [ ] **Step 3: Implementar no service**

Adicionar em `dashboard.service.ts` (usando `assignedToId` de escopo como os outros métodos):

```typescript
  async getLeadsBySource(
    organizationId: string,
    range: { from: Date; to: Date },
    assignedToId: string | undefined,
  ): Promise<Array<{ source: string; count: number }>> {
    const rows = await this.prisma.conversation.groupBy({
      by: ['source'],
      where: {
        organizationId,
        ...(assignedToId ? { assignedToId } : {}),
        createdAt: { gte: range.from, lte: range.to },
      },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      source: r.source ?? 'ORGANIC', // conversas antigas sem origem contam como orgânico
      count: r._count._all,
    }));
  }
```

- [ ] **Step 4: Endpoint no controller**

Adicionar em `dashboard.controller.ts` (espelhando `getVolumeByDay`):

```typescript
  @Get('leads-by-source')
  @ApiOperation({ summary: 'Leads por origem (CTWA / site / orgânico)' })
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  getLeadsBySource(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getLeadsBySource(
      orgId,
      this.parseRange(from, to),
      this.assignmentScope(userId, role),
    );
  }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx jest src/modules/dashboard/dashboard.service.spec.ts -t getLeadsBySource`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/dashboard
git commit -m "feat(dashboard): endpoint leads-by-source"
```

---

## Task 9: Selo de origem no web (conversa + contatos)

**Repo:** `chat-bullq-web`

**Files:**
- Create: `src/features/inbox/components/source-badge.tsx`
- Modify: header da conversa (junto dos selos 🔥/✓ existentes)
- Modify: linha da lista de contatos

- [ ] **Step 1: Localizar os selos existentes**

Run (em `chat-bullq-web`): `grep -rn "🔥\|awaitingHumanReply\|badge\|Selo\|pill" src/features/inbox/components | head`
Expected: identificar o componente do header da conversa onde os selos aparecem e o tipo `Conversation` do front (que precisa ganhar `source`).

- [ ] **Step 2: Adicionar `source` ao tipo do front**

No tipo `Conversation` do inbox (provável `src/features/inbox/types.ts` ou dentro do service), adicionar:

```typescript
  source?: 'CTWA' | 'SITE_FORM' | 'ORGANIC' | null;
```

Conferir que o mapper/serializer da API já devolve `source` (a API expõe o campo do Prisma; se houver DTO de saída explícito da conversa, adicionar `source` lá também).

- [ ] **Step 3: Criar o componente do selo**

Criar `src/features/inbox/components/source-badge.tsx`:

```tsx
type Source = 'CTWA' | 'SITE_FORM' | 'ORGANIC' | null | undefined;

const MAP: Record<'CTWA' | 'SITE_FORM' | 'ORGANIC', { label: string; className: string; title: string }> = {
  CTWA:      { label: 'Anúncio',  className: 'bg-violet-100 text-violet-700', title: 'Veio de anúncio Click-to-WhatsApp' },
  SITE_FORM: { label: 'Site',     className: 'bg-sky-100 text-sky-700',       title: 'Veio do formulário do site' },
  ORGANIC:   { label: 'Orgânico', className: 'bg-zinc-100 text-zinc-600',     title: 'Sem origem rastreada' },
};

export function SourceBadge({ source }: { source: Source }) {
  if (!source) return null;
  const cfg = MAP[source];
  if (!cfg) return null;
  return (
    <span
      title={cfg.title}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}
```

> Ajustar classes ao design system violeta do projeto se houver tokens próprios (ver `redesign-foundation-inbox`). Reusar o wrapper de selos existente.

- [ ] **Step 4: Inserir no header da conversa**

No componente do header identificado no Step 1, renderizar `<SourceBadge source={conversation.source} />` junto dos selos. **Cuidado com o vazamento da barra de ações** (pegadinha conhecida do `lead-notes-feature`): o container dos selos deve ter `flex-wrap` com `[&>*]:shrink-0`, não `overflow-x-auto`.

- [ ] **Step 5: Inserir na lista de contatos**

Na linha da lista de Contatos (feature de contatos), renderizar `<SourceBadge source={contact.source} />`. Adicionar `source` ao tipo `Contact` do front igual ao Step 2.

- [ ] **Step 6: Verificação manual**

Run: `npm run build` (ou `yarn build`) em `chat-bullq-web`
Expected: build verde. Verificar visualmente numa conversa de teste (após o backend estar rodando) que o selo aparece e não quebra o layout do header em coluna estreita.

- [ ] **Step 7: Commit**

```bash
git add src/features/inbox/components/source-badge.tsx src/features/inbox src/features/contacts
git commit -m "feat(web): selo de origem na conversa e na lista de contatos"
```

---

## Task 10: Card "Leads por origem" no dashboard (web)

**Repo:** `chat-bullq-web`

**Files:**
- Modify: `src/features/dashboard/services/dashboard.service.ts`
- Create/Modify: componente do card no dashboard

- [ ] **Step 1: Método no service do front**

Em `src/features/dashboard/services/dashboard.service.ts`, seguir o padrão dos outros fetchers (ex.: `getVolumeByDay`) e adicionar:

```typescript
export interface LeadsBySourceRow { source: 'CTWA' | 'SITE_FORM' | 'ORGANIC'; count: number; }

export async function getLeadsBySource(params: { from?: string; to?: string }): Promise<LeadsBySourceRow[]> {
  const res = await api.get('/dashboard/leads-by-source', { params });
  return res.data; // ajustar se o front usa envelope { data, meta }
}
```

> Conferir se o cliente HTTP do front desembrulha `{ data, meta }` (pegadinha do `resumo-ia-conversa-feature`). Usar o mesmo helper dos outros métodos do dashboard.

- [ ] **Step 2: Card com gráfico**

Criar/registrar um card no dashboard que consome `getLeadsBySource` via React Query e renderiza um donut (ou barras) com os rótulos "Anúncio / Site / Orgânico" e as mesmas cores do `SourceBadge`. Reusar a lib de charts já usada no dashboard (identificar com `grep -rn "recharts\|Chart\|Donut\|Pie" src/features/dashboard`). Mapear os labels:

```tsx
const LABELS = { CTWA: 'Anúncio', SITE_FORM: 'Site', ORGANIC: 'Orgânico' };
const COLORS = { CTWA: '#7c3aed', SITE_FORM: '#0ea5e9', ORGANIC: '#a1a1aa' };
```

Respeitar o filtro de range de data que os outros cards do dashboard já usam (passar `from`/`to`).

- [ ] **Step 3: Verificação manual**

Run: `npm run build` (ou `yarn build`)
Expected: build verde. Com o backend rodando e alguns `LeadIntake`/conversas de teste, o card mostra a distribuição por origem e responde ao filtro de datas.

- [ ] **Step 4: Commit**

```bash
git add src/features/dashboard
git commit -m "feat(web): card Leads por origem no dashboard"
```

---

## Verificação final (antes do PR)

- [ ] `npx jest` (API) verde — em especial `attribution`, `lead-intake`, `dashboard`, `phone.util`, `whatsapp-official`.
- [ ] `npx prisma validate` OK e a migration é 100% aditiva (sem `DROP`).
- [ ] Build do web verde nos dois repos.
- [ ] **E2E site (testável agora):** `POST /webhooks/lead-intake/:org?secret=...` cria `LeadIntake`; simular inbound do mesmo telefone → conversa nasce com `source=SITE_FORM` e o `LeadIntake` fica `consumedAt`; selo "Site" aparece.
- [ ] **CTWA:** validar só quando o número oficial ligar (payload com `message.referral` → conversa `source=CTWA`). Documentar no PR que contatos antigos não têm origem retroativa.
- [ ] Abrir **PR no fork `klebermdc`, base `feat/meta-capi-ctwa`** (empilha sobre o referral já capturado; se o #27 já tiver mergeado, base `feat/conversation-tabs`). Não push direto. Buildar trial do schema antes; conferir que a migration deste plano vem DEPOIS de `20260709000000_meta_capi_ctwa`.
- [ ] Pós-merge/deploy: rodar migrate no VPS; gerar o secret (`POST /lead-intake/secret/rotate`); configurar a ação **Webhook** no Elementor Submissions apontando para `/webhooks/lead-intake/:organizationId` com `x-lead-intake-secret` + campos ocultos `page`/`utm_*`.

---

## Auto-revisão do plano (cobertura vs spec)

- **Colunas dedicadas (Conversation + Contact first-touch):** Task 1, 5. ✅
- **LeadIntake + webhook Elementor:** Task 1, 6, 7. ✅
- **Captura CTWA no adapter oficial:** herdada do meta-capi (Task 3 = verificação); consumida na Task 4/5. ✅
- **Regra de prioridade CTWA > SITE_FORM > ORGANIC:** Task 4. ✅
- **Normalização/casamento de telefone (risco nº 1):** Task 2, 4, 6. ✅
- **Selo (conversa + contatos):** Task 9. ✅
- **Card "Leads por origem":** Task 8, 10. ✅
- **Reabertura não re-atribui / first-touch estável:** Task 5. ✅
- **Rollout aditivo, sem backfill, PR no fork:** Task 1, Verificação final. ✅
- **Fora de escopo (retroativo, multi-touch, IG ad):** respeitado — nenhuma task os inclui. ✅
