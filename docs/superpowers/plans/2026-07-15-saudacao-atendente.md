# Saudação Automática do Atendente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quando um atendente assume um atendimento (aprovar handoff distribuído, transferência, ou atribuição manual), o sistema envia sozinho uma mensagem de apresentação ao cliente no WhatsApp, usando um template configurável por org com o 1º nome do atendente.

**Architecture:** Um serviço central `AttendantGreetingService.greet(...)` renderiza um template por-org e envia uma mensagem TEXT real via `MessagesService.send` (best-effort, engole erros). Três gatilhos o chamam: `PendingActionService.approve()`, `ConversationsService.transfer()` e `ConversationsService.update()`. Settings ficam num model `AttendantGreetingSettings` (espelha `InactivitySettings`), editável via REST + tela de configurações.

**Tech Stack:** NestJS, Prisma, BullMQ, Jest (backend `chat-bullq-api`); Next.js + React Query + Tailwind (frontend `chat-bullq-web`).

---

## Arquivos

Backend (`chat-bullq-api`):
- `prisma/schema.prisma` — novo model `AttendantGreetingSettings` + relação em `Organization`
- Create `src/modules/messaging/attendant-greeting/attendant-greeting-settings.repository.ts`
- Create `src/modules/messaging/attendant-greeting/attendant-greeting-settings.service.ts`
- Create `src/modules/messaging/attendant-greeting/dto/update-attendant-greeting-settings.dto.ts`
- Create `src/modules/messaging/attendant-greeting/attendant-greeting-settings.controller.ts`
- Create `src/modules/messaging/attendant-greeting/attendant-greeting.service.ts`
- Create `src/modules/messaging/attendant-greeting/attendant-greeting.module.ts`
- Create `src/modules/messaging/attendant-greeting/attendant-greeting.service.spec.ts`
- Create `src/modules/messaging/attendant-greeting/attendant-greeting-settings.service.spec.ts`
- Modify `src/modules/messaging/messaging.module.ts` (wire greeting module + export)
- Modify `src/modules/messaging/conversations/conversations.service.ts` (hooks transfer + update)
- Modify `src/modules/ai-agents/confirmations/confirmations.module.ts` (import greeting module)
- Modify `src/modules/ai-agents/confirmations/pending-action.service.ts` (hook approve)

Frontend (`chat-bullq-web`):
- Create `src/features/settings/attendant-greeting/service.ts`
- Create `src/features/settings/attendant-greeting/hooks.ts`
- Create `src/features/settings/attendant-greeting/settings-form.tsx`
- Create `src/app/(dashboard)/settings/greeting/page.tsx`
- Modify `src/app/(dashboard)/settings/layout.tsx` (nav link)

---

## Task 1: Prisma model + migração

**Files:**
- Modify: `prisma/schema.prisma` (model `Organization` ~linha 209; adicionar model no fim)

- [ ] **Step 1: Adicionar a relação inversa em `Organization`**

No model `Organization`, logo abaixo da linha `inactivitySettings InactivitySettings?`, adicionar:

```prisma
  attendantGreetingSettings AttendantGreetingSettings?
```

- [ ] **Step 2: Adicionar o novo model no fim do schema**

```prisma
model AttendantGreetingSettings {
  organizationId String   @id @map("organization_id")
  enabled        Boolean  @default(true)
  template       String   @default("Oi! Sou o {atendente} e vou continuar seu atendimento por aqui 😊") @db.Text
  updatedAt      DateTime @updatedAt @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@map("attendant_greeting_settings")
}
```

- [ ] **Step 3: Gerar a migração + client**

Run: `npx prisma migrate dev --name add_attendant_greeting_settings`
Expected: cria `prisma/migrations/<timestamp>_add_attendant_greeting_settings/migration.sql` e roda `prisma generate` sem erro.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(greeting): model AttendantGreetingSettings + migração"
```

---

## Task 2: Repository das settings

**Files:**
- Create: `src/modules/messaging/attendant-greeting/attendant-greeting-settings.repository.ts`

- [ ] **Step 1: Escrever o repository** (mesmo padrão de `InactivitySettingsRepository`)

```ts
import { Injectable } from '@nestjs/common';
import { AttendantGreetingSettings, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class AttendantGreetingSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(organizationId: string): Promise<AttendantGreetingSettings | null> {
    return this.prisma.attendantGreetingSettings.findUnique({
      where: { organizationId },
    });
  }

  upsert(
    organizationId: string,
    data: Prisma.AttendantGreetingSettingsUncheckedUpdateInput &
      Prisma.AttendantGreetingSettingsUncheckedCreateInput,
  ): Promise<AttendantGreetingSettings> {
    return this.prisma.attendantGreetingSettings.upsert({
      where: { organizationId },
      create: { ...data, organizationId },
      update: data,
    });
  }
}
```

- [ ] **Step 2: Compilar pra validar os tipos do Prisma**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erros referentes a `attendantGreetingSettings`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/messaging/attendant-greeting/attendant-greeting-settings.repository.ts
git commit -m "feat(greeting): settings repository"
```

---

## Task 3: Service das settings (defaults + get/update)

**Files:**
- Create: `src/modules/messaging/attendant-greeting/attendant-greeting-settings.service.ts`
- Create: `src/modules/messaging/attendant-greeting/dto/update-attendant-greeting-settings.dto.ts`
- Test: `src/modules/messaging/attendant-greeting/attendant-greeting-settings.service.spec.ts`

- [ ] **Step 1: Escrever o DTO**

`src/modules/messaging/attendant-greeting/dto/update-attendant-greeting-settings.dto.ts`:

```ts
import { IsOptional, IsBoolean, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAttendantGreetingSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Use {atendente} para inserir o 1º nome do atendente.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  template?: string;
}
```

- [ ] **Step 2: Escrever o teste do service (falha primeiro)**

`attendant-greeting-settings.service.spec.ts`:

```ts
import { AttendantGreetingSettingsService } from './attendant-greeting-settings.service';

describe('AttendantGreetingSettingsService', () => {
  const makeRepo = (row: any) => ({
    find: jest.fn().mockResolvedValue(row),
    upsert: jest.fn().mockImplementation((orgId, data) =>
      Promise.resolve({ organizationId: orgId, ...data }),
    ),
  });

  it('retorna defaults quando não há row', async () => {
    const repo = makeRepo(null);
    const svc = new AttendantGreetingSettingsService(repo as any);
    const res = await svc.get('org1');
    expect(res.enabled).toBe(true);
    expect(res.template).toContain('{atendente}');
    expect(res.organizationId).toBe('org1');
  });

  it('sobrepõe defaults com a row existente', async () => {
    const repo = makeRepo({
      organizationId: 'org1',
      enabled: false,
      template: 'Olá, sou {atendente}',
    });
    const svc = new AttendantGreetingSettingsService(repo as any);
    const res = await svc.get('org1');
    expect(res.enabled).toBe(false);
    expect(res.template).toBe('Olá, sou {atendente}');
  });

  it('update faz upsert com o patch', async () => {
    const repo = makeRepo(null);
    const svc = new AttendantGreetingSettingsService(repo as any);
    await svc.update('org1', { enabled: false });
    expect(repo.upsert).toHaveBeenCalledWith('org1', { enabled: false });
  });
});
```

- [ ] **Step 3: Rodar o teste (deve falhar)**

Run: `npx jest src/modules/messaging/attendant-greeting/attendant-greeting-settings.service.spec.ts`
Expected: FAIL — "Cannot find module './attendant-greeting-settings.service'".

- [ ] **Step 4: Escrever o service**

`attendant-greeting-settings.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AttendantGreetingSettings } from '@prisma/client';
import { AttendantGreetingSettingsRepository } from './attendant-greeting-settings.repository';
import { UpdateAttendantGreetingSettingsDto } from './dto/update-attendant-greeting-settings.dto';

export const DEFAULT_ATTENDANT_GREETING_SETTINGS = {
  enabled: true,
  template: 'Oi! Sou o {atendente} e vou continuar seu atendimento por aqui 😊',
};

export type ResolvedAttendantGreetingSettings =
  typeof DEFAULT_ATTENDANT_GREETING_SETTINGS & { organizationId: string };

@Injectable()
export class AttendantGreetingSettingsService {
  constructor(private readonly repo: AttendantGreetingSettingsRepository) {}

  async get(organizationId: string): Promise<ResolvedAttendantGreetingSettings> {
    const row = await this.repo.find(organizationId);
    return {
      organizationId,
      ...DEFAULT_ATTENDANT_GREETING_SETTINGS,
      ...(row ? { enabled: row.enabled, template: row.template } : {}),
    };
  }

  update(
    organizationId: string,
    dto: UpdateAttendantGreetingSettingsDto,
  ): Promise<AttendantGreetingSettings> {
    return this.repo.upsert(organizationId, { ...dto });
  }
}
```

- [ ] **Step 5: Rodar o teste (deve passar)**

Run: `npx jest src/modules/messaging/attendant-greeting/attendant-greeting-settings.service.spec.ts`
Expected: PASS (3 testes).

- [ ] **Step 6: Commit**

```bash
git add src/modules/messaging/attendant-greeting/attendant-greeting-settings.service.ts src/modules/messaging/attendant-greeting/dto src/modules/messaging/attendant-greeting/attendant-greeting-settings.service.spec.ts
git commit -m "feat(greeting): settings service + DTO + testes"
```

---

## Task 4: Controller das settings

**Files:**
- Create: `src/modules/messaging/attendant-greeting/attendant-greeting-settings.controller.ts`

- [ ] **Step 1: Escrever o controller** (padrão de `InactivitySettingsController`)

```ts
import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Roles } from '../../../common/decorators';
import { AttendantGreetingSettingsService } from './attendant-greeting-settings.service';
import { UpdateAttendantGreetingSettingsDto } from './dto/update-attendant-greeting-settings.dto';

@ApiTags('Attendant Greeting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('attendant-greeting/settings')
export class AttendantGreetingSettingsController {
  constructor(private readonly service: AttendantGreetingSettingsService) {}

  @Get()
  get(@CurrentOrg('id') orgId: string) {
    return this.service.get(orgId);
  }

  @Put()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  update(
    @CurrentOrg('id') orgId: string,
    @Body() dto: UpdateAttendantGreetingSettingsDto,
  ) {
    return this.service.update(orgId, dto);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/messaging/attendant-greeting/attendant-greeting-settings.controller.ts
git commit -m "feat(greeting): settings controller (GET/PUT)"
```

---

## Task 5: `AttendantGreetingService` (núcleo — render + envio best-effort)

**Files:**
- Create: `src/modules/messaging/attendant-greeting/attendant-greeting.service.ts`
- Test: `src/modules/messaging/attendant-greeting/attendant-greeting.service.spec.ts`

- [ ] **Step 1: Escrever o teste (falha primeiro)**

`attendant-greeting.service.spec.ts`:

```ts
import { AttendantGreetingService } from './attendant-greeting.service';

function makeDeps(overrides: any = {}) {
  const prisma = {
    conversation: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        organizationId: 'org1',
        isGroup: false,
      }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Bárbara Silva' }),
    },
    ...overrides.prisma,
  };
  const messages = { send: jest.fn().mockResolvedValue({ id: 'm1' }) };
  const settings = {
    get: jest.fn().mockResolvedValue({
      organizationId: 'org1',
      enabled: true,
      template: 'Oi! Sou o {atendente} e vou continuar seu atendimento 😊',
    }),
  };
  return { prisma, messages, settings };
}

describe('AttendantGreetingService', () => {
  it('envia a saudação com o 1º nome do atendente', async () => {
    const { prisma, messages, settings } = makeDeps();
    const svc = new AttendantGreetingService(
      prisma as any,
      messages as any,
      settings as any,
    );
    await svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'TRANSFER' });
    expect(messages.send).toHaveBeenCalledTimes(1);
    const [dto, senderId, orgId, access] = messages.send.mock.calls[0];
    expect(dto).toEqual({
      conversationId: 'c1',
      type: 'TEXT',
      content: { text: 'Oi! Sou o Bárbara e vou continuar seu atendimento 😊' },
    });
    expect(senderId).toBe('u1');
    expect(orgId).toBe('org1');
    expect(access).toBe('ALL');
  });

  it('não envia quando enabled=false', async () => {
    const { prisma, messages, settings } = makeDeps();
    settings.get.mockResolvedValue({ enabled: false, template: 'x' });
    const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);
    await svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'TRANSFER' });
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('não envia em conversa de grupo', async () => {
    const { prisma, messages, settings } = makeDeps();
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'c1', organizationId: 'org1', isGroup: true,
    });
    const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);
    await svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'TRANSFER' });
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('fallback "atendente" quando o usuário não tem nome', async () => {
    const { prisma, messages, settings } = makeDeps();
    prisma.user.findUnique.mockResolvedValue({ name: '  ' });
    const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);
    await svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'TRANSFER' });
    expect(messages.send.mock.calls[0][0].content.text).toContain('Sou o atendente');
  });

  it('engole erro de send (best-effort, não relança)', async () => {
    const { prisma, messages, settings } = makeDeps();
    messages.send.mockRejectedValue(new Error('24h window closed'));
    const svc = new AttendantGreetingService(prisma as any, messages as any, settings as any);
    await expect(
      svc.greet({ conversationId: 'c1', attendantUserId: 'u1', source: 'TRANSFER' }),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar o teste (deve falhar)**

Run: `npx jest src/modules/messaging/attendant-greeting/attendant-greeting.service.spec.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Escrever o service**

`attendant-greeting.service.ts`:

```ts
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { MessagesService } from '../messages/messages.service';
import { AttendantGreetingSettingsService } from './attendant-greeting-settings.service';

export type GreetingSource = 'HANDOFF_APPROVE' | 'TRANSFER' | 'MANUAL_ASSIGN';

@Injectable()
export class AttendantGreetingService {
  private readonly logger = new Logger(AttendantGreetingService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => MessagesService))
    private readonly messages: MessagesService,
    private readonly settings: AttendantGreetingSettingsService,
  ) {}

  /**
   * Envia a saudação de apresentação do atendente ao cliente. Best-effort:
   * qualquer falha (janela 24h fechada, canal off, settings) é logada e
   * engolida — nunca propaga para o gatilho (atribuição/transferência).
   */
  async greet(params: {
    conversationId: string;
    attendantUserId: string;
    source: GreetingSource;
  }): Promise<void> {
    const { conversationId, attendantUserId, source } = params;
    try {
      const conversation = await this.prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { id: true, organizationId: true, isGroup: true },
      });
      if (!conversation || conversation.isGroup) return;

      const settings = await this.settings.get(conversation.organizationId);
      if (!settings.enabled) return;

      const user = await this.prisma.user.findUnique({
        where: { id: attendantUserId },
        select: { name: true },
      });
      const firstName =
        (user?.name ?? '').trim().split(/\s+/)[0] || 'atendente';
      const text = settings.template.split('{atendente}').join(firstName);

      await this.messages.send(
        { conversationId, type: 'TEXT', content: { text } },
        attendantUserId,
        conversation.organizationId,
        'ALL',
      );

      this.logger.log({
        msg: 'attendant_greeting_sent',
        conversationId,
        attendantUserId,
        source,
      });
    } catch (err: any) {
      this.logger.warn(
        `attendant greeting falhou (conv=${conversationId}, source=${source}): ${err?.message ?? err}`,
      );
    }
  }
}
```

- [ ] **Step 4: Rodar o teste (deve passar)**

Run: `npx jest src/modules/messaging/attendant-greeting/attendant-greeting.service.spec.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/messaging/attendant-greeting/attendant-greeting.service.ts src/modules/messaging/attendant-greeting/attendant-greeting.service.spec.ts
git commit -m "feat(greeting): AttendantGreetingService (render + envio best-effort)"
```

---

## Task 6: Módulo + wiring (forwardRef)

**Files:**
- Create: `src/modules/messaging/attendant-greeting/attendant-greeting.module.ts`
- Modify: `src/modules/messaging/messaging.module.ts`

- [ ] **Step 1: Escrever o módulo do greeting**

`attendant-greeting.module.ts`:

```ts
import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../database/prisma.module';
import { MessagingModule } from '../messaging.module';
import { AttendantGreetingService } from './attendant-greeting.service';
import { AttendantGreetingSettingsService } from './attendant-greeting-settings.service';
import { AttendantGreetingSettingsRepository } from './attendant-greeting-settings.repository';
import { AttendantGreetingSettingsController } from './attendant-greeting-settings.controller';

@Module({
  imports: [PrismaModule, forwardRef(() => MessagingModule)],
  controllers: [AttendantGreetingSettingsController],
  providers: [
    AttendantGreetingService,
    AttendantGreetingSettingsService,
    AttendantGreetingSettingsRepository,
  ],
  exports: [AttendantGreetingService, AttendantGreetingSettingsService],
})
export class AttendantGreetingModule {}
```

- [ ] **Step 2: Wire no `MessagingModule`**

Em `src/modules/messaging/messaging.module.ts`, adicionar o import no topo:

```ts
import { AttendantGreetingModule } from './attendant-greeting/attendant-greeting.module';
```

No array `imports`, adicionar (a `forwardRef` já está importada do `@nestjs/common` no topo do arquivo):

```ts
    forwardRef(() => AttendantGreetingModule),
```

- [ ] **Step 3: Bootar a API pra validar o grafo de DI**

Run: `npx nest build` (ou `npm run build`)
Expected: build sem erro de dependência circular. Se acusar circular envolvendo `ConfirmationsModule`, aplicar o mesmo `forwardRef(() => AttendantGreetingModule)` no import lá (Task 9) — mas normalmente uma aresta forwardRef por ciclo basta.

- [ ] **Step 4: Commit**

```bash
git add src/modules/messaging/attendant-greeting/attendant-greeting.module.ts src/modules/messaging/messaging.module.ts
git commit -m "feat(greeting): módulo + wiring no MessagingModule"
```

---

## Task 7: Gatilho — transferência

**Files:**
- Modify: `src/modules/messaging/conversations/conversations.service.ts` (import + constructor + método `transfer`, ~linha 472)

- [ ] **Step 1: Importar o service + injetar no constructor**

No topo do arquivo, adicionar o import:

```ts
import { AttendantGreetingService } from '../attendant-greeting/attendant-greeting.service';
```

Garantir que `Inject` e `forwardRef` estão importados de `@nestjs/common` (adicionar se faltar). No constructor (após `private readonly summarizer: ConversationSummaryService,`), adicionar o parâmetro:

```ts
    @Inject(forwardRef(() => AttendantGreetingService))
    private readonly attendantGreeting: AttendantGreetingService,
```

- [ ] **Step 2: Chamar a saudação no fim do `transfer`**

Em `transfer(...)`, logo antes de `return updated;` (após `this.broadcastUpdate(...)`), adicionar:

```ts
    await this.attendantGreeting.greet({
      conversationId: id,
      attendantUserId: toUserId,
      source: 'TRANSFER',
    });
```

- [ ] **Step 3: Build pra validar DI + tipos**

Run: `npx nest build`
Expected: sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/modules/messaging/conversations/conversations.service.ts
git commit -m "feat(greeting): dispara saudação na transferência"
```

---

## Task 8: Gatilho — atribuição manual (`update`)

**Files:**
- Modify: `src/modules/messaging/conversations/conversations.service.ts` (método `update`, ~linha 429)

- [ ] **Step 1: Detectar troca de responsável e saudar**

Substituir o bloco de assign dentro de `update(...)`:

```ts
    if (dto.assignedToId) {
      await this.fsm.assign(id, dto.assignedToId, actorId);
    }
```

por:

```ts
    const assigneeChanged =
      !!dto.assignedToId && dto.assignedToId !== conversation.assignedToId;
    if (dto.assignedToId) {
      await this.fsm.assign(id, dto.assignedToId, actorId);
    }
```

E logo antes de `return updated;` (após `this.broadcastUpdate(...)`), adicionar:

```ts
    if (assigneeChanged) {
      await this.attendantGreeting.greet({
        conversationId: id,
        attendantUserId: dto.assignedToId!,
        source: 'MANUAL_ASSIGN',
      });
    }
```

- [ ] **Step 2: Build**

Run: `npx nest build`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add src/modules/messaging/conversations/conversations.service.ts
git commit -m "feat(greeting): dispara saudação na atribuição manual (troca de responsável)"
```

---

## Task 9: Gatilho — "Iniciar atendimento" (aprovar handoff distribuído)

**Files:**
- Modify: `src/modules/ai-agents/confirmations/confirmations.module.ts`
- Modify: `src/modules/ai-agents/confirmations/pending-action.service.ts` (método `approve`, ~linha 79)

- [ ] **Step 1: Importar o `AttendantGreetingModule` no `ConfirmationsModule`**

Em `confirmations.module.ts`, adicionar o import no topo:

```ts
import { AttendantGreetingModule } from '../../messaging/attendant-greeting/attendant-greeting.module';
```

E adicionar ao array `imports`:

```ts
    AttendantGreetingModule,
```

- [ ] **Step 2: Injetar o service no `PendingActionService`**

Em `pending-action.service.ts`, adicionar o import:

```ts
import { AttendantGreetingService } from '../../messaging/attendant-greeting/attendant-greeting.service';
```

No constructor, adicionar o parâmetro (após `private readonly prisma: PrismaService,`):

```ts
    private readonly attendantGreeting: AttendantGreetingService,
```

- [ ] **Step 3: Disparar a saudação no fim do `approve`, só pra handoff distribuído**

Em `approve(...)`, logo antes de `return action;`, adicionar:

```ts
    // Saudação automática: só quando a pendência foi distribuída a um
    // atendente (fluxo de handoff), não em approve genérico de outras tools.
    if (action.conversationId && (action.args as any)?.distributedTo) {
      await this.attendantGreeting.greet({
        conversationId: action.conversationId,
        attendantUserId: userId,
        source: 'HANDOFF_APPROVE',
      });
    }
```

- [ ] **Step 4: Build pra validar DI (atenção a ciclo)**

Run: `npx nest build`
Expected: sem erro de dependência circular. Se acusar circular, envolver o import em `forwardRef(() => AttendantGreetingModule)` no `ConfirmationsModule` e usar `@Inject(forwardRef(() => AttendantGreetingService))` no constructor.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ai-agents/confirmations/confirmations.module.ts src/modules/ai-agents/confirmations/pending-action.service.ts
git commit -m "feat(greeting): dispara saudação ao Iniciar atendimento (aprovar handoff)"
```

---

## Task 10: Suite backend verde

**Files:** nenhum (validação)

- [ ] **Step 1: Rodar a suite inteira**

Run: `npx jest`
Expected: PASS (incluindo os novos specs; nenhuma regressão em conversations/pending-action).

- [ ] **Step 2: Se algum spec existente de `conversations`/`pending-action` quebrar por causa da nova dependência no constructor**, atualizar o `new ...Service(...)`/mock desses specs para passar um stub `{ greet: jest.fn() }` como `attendantGreeting`. Rodar de novo até verde.

---

## Task 11: Frontend — service + hooks

**Files:**
- Create: `src/features/settings/attendant-greeting/service.ts`
- Create: `src/features/settings/attendant-greeting/hooks.ts`

- [ ] **Step 1: Service (axios client `@/lib/api`)**

`src/features/settings/attendant-greeting/service.ts`:

```ts
import { api } from '@/lib/api';

export interface AttendantGreetingSettings {
  organizationId: string;
  enabled: boolean;
  template: string;
}

export const attendantGreetingService = {
  async get(): Promise<AttendantGreetingSettings> {
    const { data } = await api.get('/attendant-greeting/settings');
    return data;
  },
  async update(
    patch: Partial<Pick<AttendantGreetingSettings, 'enabled' | 'template'>>,
  ): Promise<AttendantGreetingSettings> {
    const { data } = await api.put('/attendant-greeting/settings', patch);
    return data;
  },
};
```

> Nota: confirmar o caminho do axios client (`@/lib/api`) — é o mesmo usado em `src/features/inbox/pending-actions/api.ts` (`import { api } from ...`). Ajustar o import se o alias diferir.

- [ ] **Step 2: Hooks React Query** (padrão de `use-inactivity.ts`)

`src/features/settings/attendant-greeting/hooks.ts`:

```ts
'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  attendantGreetingService,
  type AttendantGreetingSettings,
} from './service';

export function useAttendantGreetingSettings() {
  return useQuery({
    queryKey: ['attendant-greeting-settings'],
    queryFn: () => attendantGreetingService.get(),
  });
}

export function useUpdateAttendantGreetingSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AttendantGreetingSettings>) =>
      attendantGreetingService.update(patch),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['attendant-greeting-settings'] }),
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/features/settings/attendant-greeting/service.ts src/features/settings/attendant-greeting/hooks.ts
git commit -m "feat(greeting): web service + hooks das settings"
```

---

## Task 12: Frontend — formulário + página + nav

**Files:**
- Create: `src/features/settings/attendant-greeting/settings-form.tsx`
- Create: `src/app/(dashboard)/settings/greeting/page.tsx`
- Modify: `src/app/(dashboard)/settings/layout.tsx`

- [ ] **Step 1: Formulário**

`src/features/settings/attendant-greeting/settings-form.tsx`:

```tsx
'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  useAttendantGreetingSettings,
  useUpdateAttendantGreetingSettings,
} from './hooks';

export function AttendantGreetingSettingsForm() {
  const { data, isLoading } = useAttendantGreetingSettings();
  const update = useUpdateAttendantGreetingSettings();
  const [enabled, setEnabled] = useState(true);
  const [template, setTemplate] = useState('');

  useEffect(() => {
    if (data) {
      setEnabled(data.enabled);
      setTemplate(data.template);
    }
  }, [data]);

  if (isLoading) return <p className="text-sm text-zinc-500">Carregando…</p>;

  const onSave = () => {
    update.mutate(
      { enabled, template },
      {
        onSuccess: () => toast.success('Saudação salva'),
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : 'Erro ao salvar'),
      },
    );
  };

  return (
    <div className="max-w-xl space-y-6">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-4 w-4"
        />
        <span className="text-sm font-medium">
          Enviar saudação automática quando o atendente assume o atendimento
        </span>
      </label>

      <div className="space-y-2">
        <label className="text-sm font-medium">Mensagem</label>
        <textarea
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-zinc-300 bg-transparent p-3 text-sm dark:border-zinc-700"
        />
        <p className="text-xs text-zinc-500">
          Use <code>{'{atendente}'}</code> para inserir o 1º nome do atendente
          automaticamente.
        </p>
      </div>

      <button
        onClick={onSave}
        disabled={update.isPending}
        className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {update.isPending ? 'Salvando…' : 'Salvar'}
      </button>
    </div>
  );
}
```

> Nota: `toast` de `sonner` e as classes `violet-*` seguem o padrão do repo (ver `pending-action-banner.tsx`). Se o projeto usar outro toaster, ajustar o import.

- [ ] **Step 2: Página**

`src/app/(dashboard)/settings/greeting/page.tsx`:

```tsx
import { AttendantGreetingSettingsForm } from '@/features/settings/attendant-greeting/settings-form';

export default function GreetingSettingsPage() {
  return (
    <div className="py-6">
      <h1 className="mb-1 text-lg font-semibold">Saudação do atendente</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Mensagem enviada automaticamente ao cliente quando um atendente assume o
        atendimento.
      </p>
      <AttendantGreetingSettingsForm />
    </div>
  );
}
```

- [ ] **Step 3: Link no nav de settings**

Em `src/app/(dashboard)/settings/layout.tsx`, no array de tabs, adicionar (importar um ícone já disponível de `lucide-react`, ex. `MessageSquare`, no import de ícones no topo):

```tsx
  { href: '/settings/greeting', label: 'Saudação', icon: MessageSquare },
```

Colocar logo após a linha de `/settings/inactivity`.

- [ ] **Step 4: Build do web**

Run: `yarn build` (ou `npm run build`) no diretório `chat-bullq-web`
Expected: build sem erro de tipos/import.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/attendant-greeting/settings-form.tsx "src/app/(dashboard)/settings/greeting/page.tsx" "src/app/(dashboard)/settings/layout.tsx"
git commit -m "feat(greeting): tela de configuração da saudação + link no nav"
```

---

## Task 13: Verificação E2E manual (checklist)

**Files:** nenhum

- [ ] Distribuir um lead para um atendente → atendente clica **"Iniciar atendimento"** → cliente recebe "Oi! Sou o {1º nome}…" no WhatsApp e a mensagem aparece no thread.
- [ ] **Transferir** um cliente de um atendente para outro → cliente recebe a saudação do novo atendente.
- [ ] **Atribuir manualmente** uma conversa a um atendente → cliente recebe a saudação. Re-salvar sem trocar o responsável → **não** reenvia.
- [ ] Desligar o toggle em Configurações → Saudação → nenhum dos gatilhos envia.
- [ ] Editar o template (ex. tom mais formal) → próxima saudação usa o novo texto.
- [ ] Conversa de **grupo** → não recebe saudação.

---

## Self-Review (feito na escrita)

- **Cobertura da spec:** storage (T1-4), serviço central (T5), wiring (T6), 3 gatilhos (T7-9), frontend (T11-12), edge cases cobertos nos testes (grupo, disabled, sem nome, falha de send). ✅
- **Placeholders:** nenhum passo sem código concreto. As duas "Notas" do frontend são checagens de alias/import, não TBDs de lógica. ✅
- **Consistência de tipos:** `greet({ conversationId, attendantUserId, source })` idêntico nas 3 chamadas e no service; `GreetingSource` bate; `send(dto, senderId, orgId, 'ALL')` bate com a assinatura real de `MessagesService.send`. ✅
