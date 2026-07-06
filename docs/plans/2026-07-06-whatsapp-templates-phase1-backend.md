# WhatsApp Templates — Fase 1 (Backend núcleo) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backend para criar, submeter, acompanhar (via webhook + sync) Message Templates (HSM) do WhatsApp Cloud API, escopados por canal WHATSAPP_OFFICIAL.

**Architecture:** Model Prisma `MessageTemplate` como fonte da verdade local; um *mapper* puro converte o formato interno de componentes ⇄ payload da Graph API; `WhatsAppOfficialHttpClient` ganha métodos de template; `TemplatesService`/`Controller` expõem CRUD por canal; o webhook `message_template_status_update` atualiza o status. Segue os padrões existentes (Jest unit tests com `new Service(mockRepo)`, controllers com `@CurrentOrg`, Roles OWNER/ADMIN).

**Tech Stack:** NestJS 11, Prisma 6 (Postgres), Jest, Graph API v21.0.

**Escopo:** Só Fase 1 backend. UI (builder/gestão), Inbox e recuperação têm planos próprios. Categorias MARKETING+UTILITY. Cabeçalho de mídia é o último task.

---

## Estrutura de arquivos

```
prisma/schema.prisma                                  # + model MessageTemplate, relations
src/modules/channel-hub/message-templates/
  template-components.types.ts                        # tipos internos de componentes
  template-components.mapper.ts                       # interno ⇄ Graph API (puro)
  template-components.mapper.spec.ts
  template-validation.ts                              # regras (nome, exemplos)
  template-validation.spec.ts
  message-templates.repository.ts                     # Prisma
  message-templates.service.ts                        # create/update/submit/sync/remove
  message-templates.service.spec.ts
  message-templates.controller.ts                     # rotas por canal
  dto/create-template.dto.ts
  dto/update-template.dto.ts
  message-templates.module.ts
src/modules/channel-hub/adapters/whatsapp-official/
  whatsapp-official.http-client.ts                    # + createTemplate/listTemplates/deleteTemplate
  whatsapp-official.inbound-adapter.ts                # + parse message_template_status_update
  whatsapp-official.inbound-adapter.spec.ts           # (novo) teste do parse de status
src/modules/channel-hub/ports/inbound-channel.port.ts # + templateStatusUpdates em WebhookParseResult
src/modules/channel-hub/webhook-gateway.controller.ts # aplica status update
```

---

## Task 1: Model Prisma `MessageTemplate`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Adicionar o model** (no fim do schema, antes de nenhuma linha órfã):

```prisma
model MessageTemplate {
  id               String    @id @default(cuid())
  organizationId   String    @map("organization_id")
  channelId        String    @map("channel_id")
  name             String
  displayName      String?   @map("display_name")
  category         String
  language         String    @default("pt_BR")
  status           String    @default("DRAFT")
  components       Json
  variableExamples Json      @default("{}") @map("variable_examples")
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

- [ ] **Step 2: Adicionar as relations reversas** em `model Organization` e `model Channel` (achar cada model e acrescentar a linha na lista de relations):

```prisma
// dentro de model Organization { ... }
  messageTemplates MessageTemplate[]

// dentro de model Channel { ... }
  messageTemplates MessageTemplate[]
```

- [ ] **Step 3: Gerar a migration**

Run: `npx prisma migrate dev --name add_message_templates`
Expected: cria a migration e regenera o client sem erro.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(templates): add MessageTemplate model + migration"
```

---

## Task 2: Tipos internos de componentes

**Files:**
- Create: `src/modules/channel-hub/message-templates/template-components.types.ts`

- [ ] **Step 1: Escrever os tipos**

```ts
export type TemplateCategory = 'MARKETING' | 'UTILITY';

export type TemplateHeader =
  | { format: 'TEXT'; text: string; example?: string }
  | { format: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; exampleHandle?: string };

export type TemplateButton =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string; example?: string }
  | { type: 'PHONE_NUMBER'; text: string; phone: string };

export interface TemplateComponents {
  header?: TemplateHeader;
  body: { text: string };            // pode conter {{1}}..{{n}}
  footer?: { text: string };
  buttons?: TemplateButton[];
}

/** Exemplos por posição de variável do body: { "1": "Ana", "2": "Ingresso" } */
export type VariableExamples = Record<string, string>;

export interface GraphComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS';
  [k: string]: unknown;
}

export interface GraphCreatePayload {
  name: string;
  language: string;
  category: TemplateCategory;
  components: GraphComponent[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/channel-hub/message-templates/template-components.types.ts
git commit -m "feat(templates): internal component types"
```

---

## Task 3: Mapper interno → Graph API (TDD)

**Files:**
- Create: `src/modules/channel-hub/message-templates/template-components.mapper.ts`
- Test: `src/modules/channel-hub/message-templates/template-components.mapper.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

```ts
import { toGraphComponents, countBodyVariables } from './template-components.mapper';
import { TemplateComponents } from './template-components.types';

describe('template-components.mapper', () => {
  it('conta variáveis do body', () => {
    expect(countBodyVariables('Olá {{1}}, seu {{2}} está pronto')).toBe(2);
    expect(countBodyVariables('sem variáveis')).toBe(0);
  });

  it('mapeia body com exemplos para components da Graph API', () => {
    const c: TemplateComponents = { body: { text: 'Olá {{1}}, {{2}}' } };
    const out = toGraphComponents(c, { '1': 'Ana', '2': 'Ingresso' });
    expect(out).toContainEqual({
      type: 'BODY',
      text: 'Olá {{1}}, {{2}}',
      example: { body_text: [['Ana', 'Ingresso']] },
    });
  });

  it('mapeia header de texto e footer', () => {
    const c: TemplateComponents = {
      header: { format: 'TEXT', text: 'Fast Pass' },
      body: { text: 'oi' },
      footer: { text: 'Responda SAIR para parar' },
    };
    const out = toGraphComponents(c, {});
    expect(out).toContainEqual({ type: 'HEADER', format: 'TEXT', text: 'Fast Pass' });
    expect(out).toContainEqual({ type: 'FOOTER', text: 'Responda SAIR para parar' });
  });

  it('mapeia botões (quick reply, url, phone)', () => {
    const c: TemplateComponents = {
      body: { text: 'oi' },
      buttons: [
        { type: 'QUICK_REPLY', text: 'Parar' },
        { type: 'URL', text: 'Site', url: 'https://x.com' },
        { type: 'PHONE_NUMBER', text: 'Ligar', phone: '5511999998888' },
      ],
    };
    const out = toGraphComponents(c, {});
    expect(out).toContainEqual({
      type: 'BUTTONS',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Parar' },
        { type: 'URL', text: 'Site', url: 'https://x.com' },
        { type: 'PHONE_NUMBER', text: 'Ligar', phone_number: '5511999998888' },
      ],
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest template-components.mapper -c jest.config.js`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar o mapper**

```ts
import { TemplateComponents, VariableExamples, GraphComponent } from './template-components.types';

export function countBodyVariables(text: string): number {
  const matches = text.match(/\{\{\s*\d+\s*\}\}/g);
  return matches ? new Set(matches.map((m) => m.replace(/\D/g, ''))).size : 0;
}

export function toGraphComponents(c: TemplateComponents, examples: VariableExamples): GraphComponent[] {
  const out: GraphComponent[] = [];

  if (c.header) {
    if (c.header.format === 'TEXT') {
      const h: GraphComponent = { type: 'HEADER', format: 'TEXT', text: c.header.text };
      if (c.header.example) (h as any).example = { header_text: [c.header.example] };
      out.push(h);
    } else {
      const h: GraphComponent = { type: 'HEADER', format: c.header.format };
      if (c.header.exampleHandle) (h as any).example = { header_handle: [c.header.exampleHandle] };
      out.push(h);
    }
  }

  const nVars = countBodyVariables(c.body.text);
  const body: GraphComponent = { type: 'BODY', text: c.body.text };
  if (nVars > 0) {
    const row = Array.from({ length: nVars }, (_, i) => examples[String(i + 1)] ?? '');
    (body as any).example = { body_text: [row] };
  }
  out.push(body);

  if (c.footer) out.push({ type: 'FOOTER', text: c.footer.text });

  if (c.buttons?.length) {
    out.push({
      type: 'BUTTONS',
      buttons: c.buttons.map((b) => {
        if (b.type === 'URL') return { type: 'URL', text: b.text, url: b.url };
        if (b.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone };
        return { type: 'QUICK_REPLY', text: b.text };
      }),
    });
  }

  return out;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest template-components.mapper`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/channel-hub/message-templates/template-components.mapper.ts src/modules/channel-hub/message-templates/template-components.mapper.spec.ts
git commit -m "feat(templates): components mapper to Graph API payload"
```

---

## Task 4: Validação (TDD)

**Files:**
- Create: `src/modules/channel-hub/message-templates/template-validation.ts`
- Test: `src/modules/channel-hub/message-templates/template-validation.spec.ts`

- [ ] **Step 1: Teste que falha**

```ts
import { validateTemplateName, assertExamplesComplete } from './template-validation';

describe('template-validation', () => {
  it('aceita nome válido e rejeita inválido', () => {
    expect(validateTemplateName('recuperacao_checkout')).toBe(true);
    expect(validateTemplateName('Recuperacao Checkout')).toBe(false);
    expect(validateTemplateName('nome-com-hifen')).toBe(false);
  });

  it('exige exemplo para cada variável do body', () => {
    expect(() => assertExamplesComplete('Olá {{1}} e {{2}}', { '1': 'Ana' }))
      .toThrow(/exemplo/i);
    expect(() => assertExamplesComplete('Olá {{1}}', { '1': 'Ana' })).not.toThrow();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest template-validation`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
import { BadRequestException } from '@nestjs/common';
import { countBodyVariables } from './template-components.mapper';
import { VariableExamples } from './template-components.types';

export function validateTemplateName(name: string): boolean {
  return /^[a-z0-9_]+$/.test(name);
}

export function assertExamplesComplete(bodyText: string, examples: VariableExamples): void {
  const n = countBodyVariables(bodyText);
  for (let i = 1; i <= n; i++) {
    if (!examples[String(i)]?.trim()) {
      throw new BadRequestException(`Falta exemplo para a variável {{${i}}}`);
    }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest template-validation`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/channel-hub/message-templates/template-validation.ts src/modules/channel-hub/message-templates/template-validation.spec.ts
git commit -m "feat(templates): name + examples validation"
```

---

## Task 5: Métodos de template no HttpClient da Graph API

**Files:**
- Modify: `src/modules/channel-hub/adapters/whatsapp-official/whatsapp-official.http-client.ts`

- [ ] **Step 1: Ler o arquivo** para reusar o `getConfig()` e o axios existente (base `https://graph.facebook.com/${apiVersion}`, header `Authorization: Bearer accessToken`).

- [ ] **Step 2: Adicionar os métodos** na classe (usar o mesmo cliente axios/config já usado por `sendMessage`; `businessAccountId` vem de `getConfig(channel)`):

```ts
async createTemplate(channel: Channel, payload: GraphCreatePayload): Promise<{ id: string; status: string; category: string }> {
  const cfg = this.getConfig(channel);
  const { data } = await this.client(channel).post(`/${cfg.businessAccountId}/message_templates`, payload);
  return { id: data.id, status: data.status, category: data.category };
}

async listTemplates(channel: Channel): Promise<Array<{ id: string; name: string; status: string; category: string; language: string; components: unknown[] }>> {
  const cfg = this.getConfig(channel);
  const fields = 'id,name,status,category,language,components';
  const { data } = await this.client(channel).get(`/${cfg.businessAccountId}/message_templates?fields=${fields}&limit=200`);
  return data.data ?? [];
}

async deleteTemplate(channel: Channel, name: string, metaTemplateId?: string): Promise<void> {
  const cfg = this.getConfig(channel);
  const q = metaTemplateId ? `name=${encodeURIComponent(name)}&hsm_id=${metaTemplateId}` : `name=${encodeURIComponent(name)}`;
  await this.client(channel).delete(`/${cfg.businessAccountId}/message_templates?${q}`);
}
```

> Nota: se o arquivo não tiver um helper `client(channel)`, replicar o mesmo `axios.create({ baseURL, headers })` que o `sendMessage` usa. Importar `GraphCreatePayload` de `../../message-templates/template-components.types`.

- [ ] **Step 3: Verificar compilação**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erros novos nesse arquivo.

- [ ] **Step 4: Commit**

```bash
git add src/modules/channel-hub/adapters/whatsapp-official/whatsapp-official.http-client.ts
git commit -m "feat(templates): Graph API template CRUD in http-client"
```

---

## Task 6: Repository (Prisma)

**Files:**
- Create: `src/modules/channel-hub/message-templates/message-templates.repository.ts`

- [ ] **Step 1: Implementar** (espelha o padrão dos outros repositories do projeto — injeta `PrismaService`):

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class MessageTemplatesRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.MessageTemplateUncheckedCreateInput) {
    return this.prisma.messageTemplate.create({ data });
  }
  findManyByChannel(organizationId: string, channelId: string) {
    return this.prisma.messageTemplate.findMany({ where: { organizationId, channelId }, orderBy: { updatedAt: 'desc' } });
  }
  findById(organizationId: string, id: string) {
    return this.prisma.messageTemplate.findFirst({ where: { id, organizationId } });
  }
  update(id: string, data: Prisma.MessageTemplateUncheckedUpdateInput) {
    return this.prisma.messageTemplate.update({ where: { id }, data });
  }
  updateByMetaId(metaTemplateId: string, data: Prisma.MessageTemplateUncheckedUpdateInput) {
    return this.prisma.messageTemplate.updateMany({ where: { metaTemplateId }, data });
  }
  delete(id: string) {
    return this.prisma.messageTemplate.delete({ where: { id } });
  }
}
```

> Verificar o caminho de `PrismaService` (procurar `import.*PrismaService` em outro repository e copiar o path exato).

- [ ] **Step 2: Verificar compilação**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add src/modules/channel-hub/message-templates/message-templates.repository.ts
git commit -m "feat(templates): prisma repository"
```

---

## Task 7: DTOs

**Files:**
- Create: `src/modules/channel-hub/message-templates/dto/create-template.dto.ts`
- Create: `src/modules/channel-hub/message-templates/dto/update-template.dto.ts`

- [ ] **Step 1: create-template.dto.ts**

```ts
import { IsString, IsIn, IsObject, IsOptional } from 'class-validator';
import { TemplateComponents, VariableExamples } from '../template-components.types';

export class CreateTemplateDto {
  @IsString() name: string;
  @IsOptional() @IsString() displayName?: string;
  @IsIn(['MARKETING', 'UTILITY']) category: 'MARKETING' | 'UTILITY';
  @IsOptional() @IsString() language?: string;
  @IsObject() components: TemplateComponents;
  @IsOptional() @IsObject() variableExamples?: VariableExamples;
}
```

- [ ] **Step 2: update-template.dto.ts**

```ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateTemplateDto } from './create-template.dto';
export class UpdateTemplateDto extends PartialType(CreateTemplateDto) {}
```

> Se o projeto usa `@nestjs/swagger` PartialType em vez de mapped-types, usar o mesmo import dos outros DTOs (checar um `update-*.dto.ts` existente).

- [ ] **Step 3: Commit**

```bash
git add src/modules/channel-hub/message-templates/dto
git commit -m "feat(templates): DTOs"
```

---

## Task 8: Service (TDD)

**Files:**
- Create: `src/modules/channel-hub/message-templates/message-templates.service.ts`
- Test: `src/modules/channel-hub/message-templates/message-templates.service.spec.ts`

- [ ] **Step 1: Teste que falha** (mocka repo, httpClient e um channelsService que devolve o canal):

```ts
import { MessageTemplatesService } from './message-templates.service';

const channel = { id: 'ch1', type: 'WHATSAPP_OFFICIAL', config: { businessAccountId: 'WABA1' } };

const build = () => {
  const repo = {
    create: jest.fn().mockResolvedValue({ id: 't1', name: 'promo', status: 'DRAFT' }),
    findById: jest.fn().mockResolvedValue({ id: 't1', channelId: 'ch1', name: 'promo', category: 'MARKETING', language: 'pt_BR', status: 'DRAFT', components: { body: { text: 'Olá {{1}}' } }, variableExamples: { '1': 'Ana' } }),
    update: jest.fn().mockResolvedValue({ id: 't1', status: 'PENDING' }),
    findManyByChannel: jest.fn().mockResolvedValue([]),
    updateByMetaId: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const http = {
    createTemplate: jest.fn().mockResolvedValue({ id: 'META1', status: 'PENDING', category: 'MARKETING' }),
    listTemplates: jest.fn().mockResolvedValue([]),
  };
  const channels = { getForOrg: jest.fn().mockResolvedValue(channel) };
  const service = new MessageTemplatesService(repo as any, http as any, channels as any);
  return { repo, http, channels, service };
};

describe('MessageTemplatesService', () => {
  it('create rejeita nome inválido', async () => {
    const { service } = build();
    await expect(service.create('org1', 'ch1', { name: 'Nome Ruim', category: 'MARKETING', components: { body: { text: 'oi' } } } as any))
      .rejects.toThrow();
  });

  it('create salva DRAFT com nome válido', async () => {
    const { repo, service } = build();
    await service.create('org1', 'ch1', { name: 'promo', category: 'MARKETING', components: { body: { text: 'oi' } } } as any);
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'promo', status: 'DRAFT', channelId: 'ch1', organizationId: 'org1' }));
  });

  it('submit envia à Meta e marca PENDING com metaTemplateId', async () => {
    const { repo, http, service } = build();
    await service.submit('org1', 't1');
    expect(http.createTemplate).toHaveBeenCalledWith(channel, expect.objectContaining({ name: 'promo', category: 'MARKETING' }));
    expect(repo.update).toHaveBeenCalledWith('t1', expect.objectContaining({ status: 'PENDING', metaTemplateId: 'META1' }));
  });

  it('applyStatusUpdate atualiza por metaTemplateId', async () => {
    const { repo, service } = build();
    await service.applyStatusUpdate('META1', 'APPROVED');
    expect(repo.updateByMetaId).toHaveBeenCalledWith('META1', expect.objectContaining({ status: 'APPROVED' }));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest message-templates.service`
Expected: FAIL.

- [ ] **Step 3: Implementar**

```ts
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { MessageTemplatesRepository } from './message-templates.repository';
import { WhatsAppOfficialHttpClient } from '../adapters/whatsapp-official/whatsapp-official.http-client';
import { ChannelsService } from '../channels/channels.service';
import { toGraphComponents } from './template-components.mapper';
import { validateTemplateName, assertExamplesComplete } from './template-validation';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Injectable()
export class MessageTemplatesService {
  constructor(
    private readonly repo: MessageTemplatesRepository,
    private readonly http: WhatsAppOfficialHttpClient,
    private readonly channels: ChannelsService,
  ) {}

  async create(orgId: string, channelId: string, dto: CreateTemplateDto) {
    if (!validateTemplateName(dto.name)) throw new BadRequestException('Nome inválido: use apenas minúsculas, números e _');
    await this.requireOfficialChannel(orgId, channelId);
    return this.repo.create({
      organizationId: orgId, channelId, name: dto.name, displayName: dto.displayName,
      category: dto.category, language: dto.language ?? 'pt_BR', status: 'DRAFT',
      components: dto.components as any, variableExamples: (dto.variableExamples ?? {}) as any,
    });
  }

  list(orgId: string, channelId: string) {
    return this.repo.findManyByChannel(orgId, channelId);
  }

  async update(orgId: string, id: string, dto: UpdateTemplateDto) {
    const t = await this.mustFind(orgId, id);
    if (!['DRAFT', 'REJECTED'].includes(t.status)) throw new BadRequestException('Só é possível editar rascunho ou rejeitado');
    if (dto.name && !validateTemplateName(dto.name)) throw new BadRequestException('Nome inválido');
    return this.repo.update(id, {
      ...(dto.name && { name: dto.name }), ...(dto.displayName !== undefined && { displayName: dto.displayName }),
      ...(dto.category && { category: dto.category }), ...(dto.language && { language: dto.language }),
      ...(dto.components && { components: dto.components as any }),
      ...(dto.variableExamples && { variableExamples: dto.variableExamples as any }),
    });
  }

  async submit(orgId: string, id: string) {
    const t = await this.mustFind(orgId, id);
    const channel = await this.requireOfficialChannel(orgId, t.channelId);
    const components = t.components as any;
    assertExamplesComplete(components.body.text, (t.variableExamples ?? {}) as any);
    const payload = {
      name: t.name, language: t.language, category: t.category as 'MARKETING' | 'UTILITY',
      components: toGraphComponents(components, (t.variableExamples ?? {}) as any),
    };
    const res = await this.http.createTemplate(channel, payload);
    return this.repo.update(id, { status: 'PENDING', metaTemplateId: res.id, submittedAt: new Date() });
  }

  async sync(orgId: string, channelId: string) {
    const channel = await this.requireOfficialChannel(orgId, channelId);
    const remote = await this.http.listTemplates(channel);
    for (const r of remote) {
      await this.repo.updateByMetaId(r.id, { status: r.status });
    }
    return this.repo.findManyByChannel(orgId, channelId);
  }

  async applyStatusUpdate(metaTemplateId: string, status: string, rejectionReason?: string) {
    return this.repo.updateByMetaId(metaTemplateId, { status, rejectionReason: rejectionReason ?? null, reviewedAt: new Date() });
  }

  async remove(orgId: string, id: string) {
    const t = await this.mustFind(orgId, id);
    if (t.metaTemplateId) {
      const channel = await this.requireOfficialChannel(orgId, t.channelId);
      await this.http.deleteTemplate(channel, t.name, t.metaTemplateId).catch(() => undefined);
    }
    return this.repo.delete(id);
  }

  private async mustFind(orgId: string, id: string) {
    const t = await this.repo.findById(orgId, id);
    if (!t) throw new NotFoundException('Template não encontrado');
    return t;
  }

  private async requireOfficialChannel(orgId: string, channelId: string) {
    const channel = await this.channels.getForOrg(orgId, channelId);
    if (!channel || channel.type !== 'WHATSAPP_OFFICIAL') throw new BadRequestException('Canal precisa ser WhatsApp Oficial');
    if (!(channel.config as any)?.businessAccountId) throw new BadRequestException('Canal sem businessAccountId (WABA)');
    return channel;
  }
}
```

> **Ajuste de dependência:** `channels.getForOrg(orgId, channelId)` — se `ChannelsService` não tiver esse método, procurar o método existente que carrega um canal por id validando a org (ex.: `findOne`/`getById`) e usar ele no lugar (ajustar o mock do teste conforme o nome real).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest message-templates.service`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/channel-hub/message-templates/message-templates.service.ts src/modules/channel-hub/message-templates/message-templates.service.spec.ts
git commit -m "feat(templates): service (create/update/submit/sync/status/remove)"
```

---

## Task 9: Controller

**Files:**
- Create: `src/modules/channel-hub/message-templates/message-templates.controller.ts`

- [ ] **Step 1: Implementar** (copiar guards/decorators exatos de `channels.controller.ts`: `@ApiBearerAuth()`, `@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)`, `@CurrentOrg('id')`, `@Roles(...)`):

```ts
import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Roles } from '../../../common/decorators';
import { OrgRole } from '@prisma/client';
import { MessageTemplatesService } from './message-templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@ApiTags('message-templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('channels/:channelId/message-templates')
export class MessageTemplatesController {
  constructor(private readonly service: MessageTemplatesService) {}

  @Get()
  list(@CurrentOrg('id') orgId: string, @Param('channelId') channelId: string) {
    return this.service.list(orgId, channelId);
  }

  @Post()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  create(@CurrentOrg('id') orgId: string, @Param('channelId') channelId: string, @Body() dto: CreateTemplateDto) {
    return this.service.create(orgId, channelId, dto);
  }

  @Patch(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  update(@CurrentOrg('id') orgId: string, @Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.service.update(orgId, id, dto);
  }

  @Post(':id/submit')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  submit(@CurrentOrg('id') orgId: string, @Param('id') id: string) {
    return this.service.submit(orgId, id);
  }

  @Post('sync')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  sync(@CurrentOrg('id') orgId: string, @Param('channelId') channelId: string) {
    return this.service.sync(orgId, channelId);
  }

  @Delete(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  remove(@CurrentOrg('id') orgId: string, @Param('id') id: string) {
    return this.service.remove(orgId, id);
  }
}
```

> Conferir os caminhos exatos de `guards`/`decorators`/`OrgRole` copiando do topo de `channels.controller.ts`.

- [ ] **Step 2: Commit**

```bash
git add src/modules/channel-hub/message-templates/message-templates.controller.ts
git commit -m "feat(templates): controller (per-channel routes)"
```

---

## Task 10: Module + registro

**Files:**
- Create: `src/modules/channel-hub/message-templates/message-templates.module.ts`
- Modify: `src/modules/channel-hub/channel-hub.module.ts`

- [ ] **Step 1: message-templates.module.ts**

```ts
import { Module } from '@nestjs/common';
import { MessageTemplatesController } from './message-templates.controller';
import { MessageTemplatesService } from './message-templates.service';
import { MessageTemplatesRepository } from './message-templates.repository';
import { WhatsAppOfficialModule } from '../adapters/whatsapp-official/whatsapp-official.module';
import { ChannelsModule } from '../channels/channels.module'; // ajustar se o nome/local diferir
import { PrismaModule } from '../../prisma/prisma.module';     // ajustar path

@Module({
  imports: [WhatsAppOfficialModule, ChannelsModule, PrismaModule],
  controllers: [MessageTemplatesController],
  providers: [MessageTemplatesService, MessageTemplatesRepository],
  exports: [MessageTemplatesService],
})
export class MessageTemplatesModule {}
```

> Se `WhatsAppOfficialHttpClient`/`ChannelsService` não forem exportados pelos respectivos módulos, ajustar os `exports` desses módulos ou prover os providers aqui, seguindo como os outros módulos fazem.

- [ ] **Step 2: Importar em `channel-hub.module.ts`** (adicionar `MessageTemplatesModule` ao array `imports`).

- [ ] **Step 3: Subir a app localmente**

Run: `npm run build` (ou `npx tsc --noEmit`)
Expected: compila sem erro; DI resolve.

- [ ] **Step 4: Commit**

```bash
git add src/modules/channel-hub/message-templates/message-templates.module.ts src/modules/channel-hub/channel-hub.module.ts
git commit -m "feat(templates): module wiring"
```

---

## Task 11: Webhook — parsear `message_template_status_update` (TDD)

**Files:**
- Modify: `src/modules/channel-hub/ports/inbound-channel.port.ts` (adicionar campo)
- Modify: `src/modules/channel-hub/adapters/whatsapp-official/whatsapp-official.inbound-adapter.ts`
- Test: `src/modules/channel-hub/adapters/whatsapp-official/whatsapp-official.inbound-adapter.spec.ts`

- [ ] **Step 1: Estender `WebhookParseResult`** em `inbound-channel.port.ts`:

```ts
// dentro da interface WebhookParseResult
  templateStatusUpdates?: Array<{ metaTemplateId: string; status: string; reason?: string }>;
```

- [ ] **Step 2: Teste que falha** (novo spec):

```ts
import { WhatsAppOfficialInboundAdapter } from './whatsapp-official.inbound-adapter';

describe('WhatsAppOfficialInboundAdapter.parseWebhook — template status', () => {
  const adapter = new WhatsAppOfficialInboundAdapter(/* deps mockadas conforme o construtor real */ {} as any);

  it('extrai message_template_status_update', () => {
    const payload = {
      entry: [{ changes: [{ field: 'message_template_status_update', value: { message_template_id: 'META1', event: 'APPROVED', reason: null } }] }],
    };
    const res = adapter.parseWebhook(payload, { id: 'ch1' } as any);
    expect(res.templateStatusUpdates).toContainEqual({ metaTemplateId: 'META1', status: 'APPROVED', reason: undefined });
  });
});
```

> Ajustar a instanciação do adapter aos parâmetros reais do construtor (ver o topo do arquivo).

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx jest whatsapp-official.inbound-adapter`
Expected: FAIL.

- [ ] **Step 4: Implementar no `parseWebhook`** — dentro do loop de `changes`, antes/junto do tratamento atual:

```ts
if (change.field === 'message_template_status_update') {
  const v = change.value ?? {};
  (result.templateStatusUpdates ??= []).push({
    metaTemplateId: String(v.message_template_id),
    status: String(v.event ?? v.status),
    reason: v.reason ?? undefined,
  });
  continue;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx jest whatsapp-official.inbound-adapter`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/channel-hub/ports/inbound-channel.port.ts src/modules/channel-hub/adapters/whatsapp-official/whatsapp-official.inbound-adapter.ts src/modules/channel-hub/adapters/whatsapp-official/whatsapp-official.inbound-adapter.spec.ts
git commit -m "feat(templates): parse template status webhook"
```

---

## Task 12: Webhook gateway aplica o status

**Files:**
- Modify: `src/modules/channel-hub/webhook-gateway.controller.ts`

- [ ] **Step 1: Injetar `MessageTemplatesService`** no construtor do controller (e garantir que `MessageTemplatesModule` exporta o service e está importado no módulo do gateway).

- [ ] **Step 2: Após `adapter.parseWebhook(...)`**, aplicar os updates de template (perto de onde hoje enfileira messages/statuses):

```ts
for (const upd of parseResult.templateStatusUpdates ?? []) {
  await this.messageTemplatesService.applyStatusUpdate(upd.metaTemplateId, upd.status, upd.reason);
  this.logger.log(`Template ${upd.metaTemplateId} → ${upd.status}`);
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compila; DI resolve.

- [ ] **Step 4: Commit**

```bash
git add src/modules/channel-hub/webhook-gateway.controller.ts
git commit -m "feat(templates): apply template status update from webhook"
```

---

## Task 13: Smoke test manual (produção ou local)

- [ ] **Step 1:** Rodar toda a suíte:

Run: `npx jest`
Expected: verde (incluindo os novos specs).

- [ ] **Step 2:** Criar um template via API (canal oficial existente) — texto simples:

```bash
curl -sS -X POST "$BASE/channels/<CHANNEL_ID>/message-templates" \
  -H "Authorization: Bearer <JWT>" -H "x-organization-id: <ORG>" -H 'Content-Type: application/json' \
  -d '{"name":"teste_ofp","category":"UTILITY","components":{"body":{"text":"Olá {{1}}, tudo certo?"}},"variableExamples":{"1":"Ana"}}'
```
Expected: 201 com status `DRAFT`.

- [ ] **Step 3:** Submeter:

```bash
curl -sS -X POST "$BASE/channels/<CHANNEL_ID>/message-templates/<ID>/submit" -H "Authorization: Bearer <JWT>" -H "x-organization-id: <ORG>"
```
Expected: status `PENDING` + `metaTemplateId` preenchido. Em minutos, o webhook deve virar `APPROVED` (conferir com GET da lista, ou `POST .../sync`).

---

## Self-Review (feita ao escrever)
- **Cobertura do spec (Fase 1 backend):** model ✅ (T1), mapper de componentes completo incl. header/footer/buttons ✅ (T3), validação nome+exemplos ✅ (T4), Graph API CRUD ✅ (T5), repo ✅ (T6), service create/update/submit/sync/status/remove ✅ (T8), controller por canal ✅ (T9), webhook status ✅ (T11-12).
- **Cabeçalho de mídia (upload de handle):** o mapper já aceita `exampleHandle`; o **upload resumável** do arquivo de exemplo fica como task adicional na Fase 1-UI (quando houver arquivo pra subir) — marcado no spec como último item. Sem placeholder no backend: header de mídia sem handle simplesmente não manda `example`.
- **Placeholders:** nenhum "TODO/TBD"; todos os steps têm código.
- **Consistência de tipos:** `toGraphComponents`, `countBodyVariables`, `applyStatusUpdate`, `updateByMetaId`, `requireOfficialChannel` usados com as mesmas assinaturas entre tasks.
- **Pontos a confirmar na execução (marcados inline):** path de `PrismaService`/`PrismaModule`, nome real do método de carregar canal no `ChannelsService`, exports dos módulos, assinatura do construtor do inbound-adapter.
