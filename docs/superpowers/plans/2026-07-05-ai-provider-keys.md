# Menu de Provedores de IA (API Keys gerenciáveis) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um menu em `/settings/ai-providers` onde OWNER/ADMIN cadastram chaves de provedores de IA (criptografadas no banco) e selecionam o que cada chave faz (transcrição / embeddings / LLM); os serviços resolvem a chave por organização, com fallback para o `.env`.

**Architecture:** Nova tabela Prisma `ai_provider_keys` por organização. Um `CryptoService` (AES-256-GCM) cripta o segredo em repouso. Um `ProviderKeyResolverService` mapeia `(orgId, capability) → { provider, apiKey, baseUrl?, model? }` com fallback para variáveis de ambiente. Consumidores (transcrição, embeddings, LLM) passam a resolver a chave em runtime. Frontend Next.js segue o padrão das telas de settings existentes (TanStack Query + `@/lib/api`).

**Tech Stack:** NestJS, Prisma (Postgres), Node `crypto`, Jest; Next.js App Router, React, TanStack Query, Tailwind, lucide-react, sonner.

Spec: `docs/superpowers/specs/2026-07-05-ai-provider-keys-design.md`

---

## Task 0: Branch e segredo de criptografia

**Files:**
- Modify: `.env`, `.env.example` (em `chat-bullq-api/`)
- Modify: `../.env.production.example`, `../docker-compose.yml`

- [ ] **Step 1: Criar a branch de trabalho**

Run (a partir de `chat-bullq-api/`):
```bash
git checkout -b feat/ai-provider-keys
```

- [ ] **Step 2: Gerar o segredo mestre e adicionar ao `.env` local**

Run:
```bash
node -e "console.log('KEY_ENCRYPTION_SECRET=' + require('crypto').randomBytes(32).toString('hex'))"
```
Copie a linha impressa e adicione ao final de `chat-bullq-api/.env`.

- [ ] **Step 3: Adicionar placeholder aos arquivos de exemplo**

Em `chat-bullq-api/.env.example` e em `../.env.production.example` (bloco "Chaves de IA"), adicione:
```
# Chave-mestra para criptografar as API keys salvas no banco (32 bytes hex).
# Gere com: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
KEY_ENCRYPTION_SECRET=troque_por_64_hex_chars
```

- [ ] **Step 4: Passar a var ao container `api`**

Em `../docker-compose.yml`, no bloco `api > environment`, logo abaixo de `GROQ_API_KEY: ${GROQ_API_KEY}`:
```yaml
      KEY_ENCRYPTION_SECRET: ${KEY_ENCRYPTION_SECRET}
```

- [ ] **Step 5: Commit**

```bash
git add .env.example ../.env.production.example ../docker-compose.yml
git commit -m "chore: adiciona KEY_ENCRYPTION_SECRET para criptografia de API keys"
```

---

## Task 1: Modelo Prisma + migração

**Files:**
- Modify: `chat-bullq-api/prisma/schema.prisma`

- [ ] **Step 1: Adicionar enums e model ao schema**

No fim de `prisma/schema.prisma`, adicione:
```prisma
enum AiProvider {
  GROQ
  OPENAI
  SAKANA
}

enum AiCapability {
  TRANSCRIPTION
  EMBEDDINGS
  AGENT_LLM
}

model AiProviderKey {
  id             String         @id @default(cuid())
  organizationId String         @map("organization_id")
  name           String
  provider       AiProvider
  encryptedKey   String         @map("encrypted_key")
  keyPreview     String         @map("key_preview")
  capabilities   AiCapability[]
  baseUrl        String?        @map("base_url")
  model          String?
  createdAt      DateTime       @default(now()) @map("created_at")
  updatedAt      DateTime       @updatedAt @map("updated_at")

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  @@index([organizationId], name: "idx_ai_provider_key_org")
  @@map("ai_provider_keys")
}
```

- [ ] **Step 2: Adicionar a relação inversa em Organization**

No `model Organization`, junto das outras relações (ex.: perto de `apiKeys`), adicione:
```prisma
  aiProviderKeys AiProviderKey[]
```

- [ ] **Step 3: Criar a migração**

Run (em `chat-bullq-api/`):
```bash
npx prisma migrate dev --name add_ai_provider_keys
```
Expected: cria `prisma/migrations/<timestamp>_add_ai_provider_keys/` e regenera o client. Sem erros.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: modelo AiProviderKey + enums (migração)"
```

---

## Task 2: CryptoService (AES-256-GCM)

**Files:**
- Create: `chat-bullq-api/src/common/crypto/crypto.service.ts`
- Create: `chat-bullq-api/src/common/crypto/crypto.module.ts`
- Test: `chat-bullq-api/src/common/crypto/crypto.service.spec.ts`

- [ ] **Step 1: Escrever o teste que falha**

`crypto.service.spec.ts`:
```ts
import { CryptoService } from './crypto.service';
import { ConfigService } from '@nestjs/config';

const SECRET = 'a'.repeat(64); // 32 bytes em hex

function makeService(secret?: string) {
  const config = { get: (k: string) => (k === 'KEY_ENCRYPTION_SECRET' ? secret : undefined) } as unknown as ConfigService;
  return new CryptoService(config);
}

describe('CryptoService', () => {
  it('faz roundtrip encrypt -> decrypt', () => {
    const svc = makeService(SECRET);
    const plain = 'gsk_super_secret_value_123';
    const enc = svc.encrypt(plain);
    expect(enc).not.toContain(plain);
    expect(svc.decrypt(enc)).toBe(plain);
  });

  it('gera ciphertext diferente a cada chamada (IV aleatório)', () => {
    const svc = makeService(SECRET);
    expect(svc.encrypt('x')).not.toBe(svc.encrypt('x'));
  });

  it('lança se a chave-mestra estiver ausente', () => {
    const svc = makeService(undefined);
    expect(() => svc.encrypt('x')).toThrow(/KEY_ENCRYPTION_SECRET/);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx jest src/common/crypto/crypto.service.spec.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar o CryptoService**

`crypto.service.ts`:
```ts
import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Criptografia simétrica (AES-256-GCM) para segredos guardados no banco.
 * Formato de saída: base64(iv).base64(authTag).base64(ciphertext)
 */
@Injectable()
export class CryptoService {
  private static readonly ALGO = 'aes-256-gcm';

  constructor(private readonly config: ConfigService) {}

  private key(): Buffer {
    const hex = this.config.get<string>('KEY_ENCRYPTION_SECRET');
    if (!hex || hex.length !== 64) {
      throw new InternalServerErrorException(
        'KEY_ENCRYPTION_SECRET ausente ou inválida (esperado 64 chars hex)',
      );
    }
    return Buffer.from(hex, 'hex');
  }

  encrypt(plain: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(CryptoService.ALGO, this.key(), iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const [ivB64, tagB64, ctB64] = payload.split('.');
    if (!ivB64 || !tagB64 || !ctB64) {
      throw new InternalServerErrorException('Payload criptografado inválido');
    }
    const decipher = crypto.createDecipheriv(
      CryptoService.ALGO,
      this.key(),
      Buffer.from(ivB64, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(ctB64, 'base64')),
      decipher.final(),
    ]);
    return pt.toString('utf8');
  }

  /** Máscara para exibir na UI, ex.: "gsk_…70tIFI". */
  preview(plain: string): string {
    const head = plain.slice(0, 4);
    const tail = plain.slice(-6);
    return `${head}…${tail}`;
  }
}
```

`crypto.module.ts`:
```ts
import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx jest src/common/crypto/crypto.service.spec.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Registrar o CryptoModule no app**

Em `src/app.module.ts`, importar `CryptoModule` e adicionar ao array `imports` (logo após `PrismaModule`).

- [ ] **Step 6: Commit**

```bash
git add src/common/crypto src/app.module.ts
git commit -m "feat: CryptoService AES-256-GCM para segredos no banco"
```

---

## Task 3: Módulo ai-provider-keys (DTOs + service + controller)

**Files:**
- Create: `src/modules/ai-provider-keys/dto/create-ai-provider-key.dto.ts`
- Create: `src/modules/ai-provider-keys/dto/update-ai-provider-key.dto.ts`
- Create: `src/modules/ai-provider-keys/ai-provider-keys.service.ts`
- Create: `src/modules/ai-provider-keys/ai-provider-keys.controller.ts`
- Create: `src/modules/ai-provider-keys/ai-provider-keys.module.ts`
- Test: `src/modules/ai-provider-keys/ai-provider-keys.service.spec.ts`

- [ ] **Step 1: Criar os DTOs**

`dto/create-ai-provider-key.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';
import { AiProvider, AiCapability } from '@prisma/client';
import {
  IsArray, IsEnum, IsOptional, IsString, MaxLength, MinLength,
} from 'class-validator';

export class CreateAiProviderKeyDto {
  @ApiProperty({ example: 'Groq produção' })
  @IsString() @MinLength(1) @MaxLength(100)
  name: string;

  @ApiProperty({ enum: AiProvider })
  @IsEnum(AiProvider)
  provider: AiProvider;

  @ApiProperty({ example: 'gsk_...' })
  @IsString() @MinLength(8) @MaxLength(400)
  key: string;

  @ApiProperty({ enum: AiCapability, isArray: true })
  @IsArray() @IsEnum(AiCapability, { each: true })
  capabilities: AiCapability[];

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(300)
  baseUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(120)
  model?: string;
}
```

`dto/update-ai-provider-key.dto.ts`:
```ts
import { ApiProperty } from '@nestjs/swagger';
import { AiProvider, AiCapability } from '@prisma/client';
import {
  IsArray, IsEnum, IsOptional, IsString, MaxLength, MinLength,
} from 'class-validator';

export class UpdateAiProviderKeyDto {
  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100)
  name?: string;

  @ApiProperty({ required: false, enum: AiProvider })
  @IsOptional() @IsEnum(AiProvider)
  provider?: AiProvider;

  @ApiProperty({ required: false, description: 'Se preenchido, substitui a chave; se ausente, mantém a atual.' })
  @IsOptional() @IsString() @MinLength(8) @MaxLength(400)
  key?: string;

  @ApiProperty({ required: false, enum: AiCapability, isArray: true })
  @IsOptional() @IsArray() @IsEnum(AiCapability, { each: true })
  capabilities?: AiCapability[];

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(300)
  baseUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional() @IsString() @MaxLength(120)
  model?: string;
}
```

- [ ] **Step 2: Escrever o teste do service (regra de dono único + máscara)**

`ai-provider-keys.service.spec.ts`:
```ts
import { AiProviderKeysService } from './ai-provider-keys.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ConfigService } from '@nestjs/config';

const SECRET = 'a'.repeat(64);
const crypto = new CryptoService({ get: () => SECRET } as unknown as ConfigService);

function makePrismaMock() {
  const rows: any[] = [];
  return {
    rows,
    aiProviderKey: {
      create: jest.fn(async ({ data }: any) => { const r = { id: 'id' + rows.length, ...data }; rows.push(r); return r; }),
      findMany: jest.fn(async ({ where }: any) => rows.filter((r) => r.organizationId === where.organizationId)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        rows.filter((r) => r.organizationId === where.organizationId && where.capabilities?.hasSome?.every)
          .forEach(() => {});
        // simula "remove capability das demais": aplica set
        rows.forEach((r) => {
          if (r.organizationId === where.organizationId && (!where.id || r.id !== where.id.not)) {
            r.capabilities = (r.capabilities || []).filter((c: string) => !data._removeCaps?.includes(c));
          }
        });
        return { count: 0 };
      }),
    },
  };
}

describe('AiProviderKeysService — dono único', () => {
  it('ao criar uma chave com TRANSCRIPTION, remove TRANSCRIPTION das outras', async () => {
    const prisma = makePrismaMock();
    const svc = new AiProviderKeysService(prisma as any, crypto);
    await svc.create('org1', { name: 'A', provider: 'OPENAI', key: 'sk-aaaaaaaa', capabilities: ['TRANSCRIPTION', 'EMBEDDINGS'] } as any);
    await svc.create('org1', { name: 'B', provider: 'GROQ', key: 'gsk_bbbbbbbb', capabilities: ['TRANSCRIPTION'] } as any);
    const list = await svc.findAll('org1');
    const a = list.find((r: any) => r.name === 'A');
    const b = list.find((r: any) => r.name === 'B');
    expect(b.capabilities).toContain('TRANSCRIPTION');
    expect(a.capabilities).not.toContain('TRANSCRIPTION');
    expect(a.capabilities).toContain('EMBEDDINGS');
  });

  it('nunca expõe a chave crua, só o preview', async () => {
    const prisma = makePrismaMock();
    const svc = new AiProviderKeysService(prisma as any, crypto);
    await svc.create('org1', { name: 'A', provider: 'GROQ', key: 'gsk_secret12345', capabilities: [] } as any);
    const list = await svc.findAll('org1');
    expect(JSON.stringify(list)).not.toContain('gsk_secret12345');
    expect(list[0].keyPreview).toBe('gsk_…12345');
  });
});
```

> Nota para o implementador: o mock acima é ilustrativo. A implementação real usa
> `capabilities` como enum array do Postgres. Ajuste o mock se necessário para
> refletir a assinatura final de `enforceSingleOwner` — o comportamento testado
> (dono único + preview) é o que importa.

- [ ] **Step 3: Rodar e ver falhar**

Run: `npx jest src/modules/ai-provider-keys/ai-provider-keys.service.spec.ts`
Expected: FAIL (service não existe).

- [ ] **Step 4: Implementar o service**

`ai-provider-keys.service.ts`:
```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { AiCapability, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CreateAiProviderKeyDto } from './dto/create-ai-provider-key.dto';
import { UpdateAiProviderKeyDto } from './dto/update-ai-provider-key.dto';

const PUBLIC_SELECT = {
  id: true, name: true, provider: true, keyPreview: true,
  capabilities: true, baseUrl: true, model: true,
  createdAt: true, updatedAt: true,
} satisfies Prisma.AiProviderKeySelect;

@Injectable()
export class AiProviderKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async findAll(organizationId: string) {
    return this.prisma.aiProviderKey.findMany({
      where: { organizationId },
      select: PUBLIC_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(organizationId: string, dto: CreateAiProviderKeyDto) {
    const caps = dto.capabilities ?? [];
    const created = await this.prisma.aiProviderKey.create({
      data: {
        organizationId,
        name: dto.name,
        provider: dto.provider,
        encryptedKey: this.crypto.encrypt(dto.key),
        keyPreview: this.crypto.preview(dto.key),
        capabilities: caps,
        baseUrl: dto.baseUrl ?? null,
        model: dto.model ?? null,
      },
      select: PUBLIC_SELECT,
    });
    await this.enforceSingleOwner(organizationId, created.id, caps);
    return this.findOne(organizationId, created.id);
  }

  async update(organizationId: string, id: string, dto: UpdateAiProviderKeyDto) {
    await this.findOne(organizationId, id);
    const data: Prisma.AiProviderKeyUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.provider !== undefined) data.provider = dto.provider;
    if (dto.baseUrl !== undefined) data.baseUrl = dto.baseUrl;
    if (dto.model !== undefined) data.model = dto.model;
    if (dto.capabilities !== undefined) data.capabilities = dto.capabilities;
    if (dto.key) {
      data.encryptedKey = this.crypto.encrypt(dto.key);
      data.keyPreview = this.crypto.preview(dto.key);
    }
    await this.prisma.aiProviderKey.update({ where: { id }, data });
    if (dto.capabilities !== undefined) {
      await this.enforceSingleOwner(organizationId, id, dto.capabilities);
    }
    return this.findOne(organizationId, id);
  }

  async remove(organizationId: string, id: string) {
    await this.findOne(organizationId, id);
    await this.prisma.aiProviderKey.delete({ where: { id } });
    return { message: 'Chave removida' };
  }

  private async findOne(organizationId: string, id: string) {
    const row = await this.prisma.aiProviderKey.findFirst({
      where: { id, organizationId },
      select: PUBLIC_SELECT,
    });
    if (!row) throw new NotFoundException('Chave não encontrada');
    return row;
  }

  /** Remove as capabilities recém-atribuídas de qualquer OUTRA chave da org. */
  private async enforceSingleOwner(
    organizationId: string, keepId: string, caps: AiCapability[],
  ) {
    if (!caps.length) return;
    const others = await this.prisma.aiProviderKey.findMany({
      where: { organizationId, id: { not: keepId } },
      select: { id: true, capabilities: true },
    });
    for (const o of others) {
      const filtered = o.capabilities.filter((c) => !caps.includes(c));
      if (filtered.length !== o.capabilities.length) {
        await this.prisma.aiProviderKey.update({
          where: { id: o.id }, data: { capabilities: filtered },
        });
      }
    }
  }
}
```

> Se o teste do Step 2 usar um mock simplificado, ajuste-o para expor
> `aiProviderKey.findMany/update/create/delete/findFirst` conforme acima, ou
> converta este teste para um teste de integração com banco de testes. O
> comportamento a garantir é: dono único + preview + segredo nunca retornado.

- [ ] **Step 5: Rodar e ver passar**

Run: `npx jest src/modules/ai-provider-keys/ai-provider-keys.service.spec.ts`
Expected: PASS.

- [ ] **Step 6: Implementar o controller**

`ai-provider-keys.controller.ts`:
```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { AiProviderKeysService } from './ai-provider-keys.service';
import { CreateAiProviderKeyDto } from './dto/create-ai-provider-key.dto';
import { UpdateAiProviderKeyDto } from './dto/update-ai-provider-key.dto';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, Roles } from '../../common/decorators';

@ApiTags('AI Provider Keys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('ai-provider-keys')
export class AiProviderKeysController {
  constructor(private readonly service: AiProviderKeysService) {}

  @Get()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Lista as chaves de provedores de IA (mascaradas)' })
  list(@CurrentOrg('id') orgId: string) {
    return this.service.findAll(orgId);
  }

  @Post()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Cadastra uma chave de provedor de IA' })
  create(@CurrentOrg('id') orgId: string, @Body() dto: CreateAiProviderKeyDto) {
    return this.service.create(orgId, dto);
  }

  @Patch(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Atualiza uma chave de provedor de IA' })
  update(@CurrentOrg('id') orgId: string, @Param('id') id: string, @Body() dto: UpdateAiProviderKeyDto) {
    return this.service.update(orgId, id, dto);
  }

  @Delete(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Remove uma chave de provedor de IA' })
  remove(@CurrentOrg('id') orgId: string, @Param('id') id: string) {
    return this.service.remove(orgId, id);
  }
}
```

- [ ] **Step 7: Criar o módulo (inclui o Resolver da Task 4)**

`ai-provider-keys.module.ts`:
```ts
import { Module } from '@nestjs/common';
import { AiProviderKeysController } from './ai-provider-keys.controller';
import { AiProviderKeysService } from './ai-provider-keys.service';
import { ProviderKeyResolverService } from './provider-key-resolver.service';

@Module({
  controllers: [AiProviderKeysController],
  providers: [AiProviderKeysService, ProviderKeyResolverService],
  exports: [ProviderKeyResolverService],
})
export class AiProviderKeysModule {}
```

> `provider-key-resolver.service.ts` é criado na Task 4. Se estiver executando em
> ordem, crie o módulo com o import comentado até a Task 4 e descomente depois,
> ou faça a Task 4 antes de compilar.

- [ ] **Step 8: Registrar no app.module + compilar**

Em `src/app.module.ts`, importar `AiProviderKeysModule` e adicioná-lo ao array `imports` (perto de `ApiKeysModule`).

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erros.

- [ ] **Step 9: Commit**

```bash
git add src/modules/ai-provider-keys src/app.module.ts
git commit -m "feat: CRUD de AI provider keys (OWNER/ADMIN) com dono único por função"
```

---

## Task 4: ProviderKeyResolverService (banco + fallback .env)

**Files:**
- Create: `src/modules/ai-provider-keys/provider-key-resolver.service.ts`
- Test: `src/modules/ai-provider-keys/provider-key-resolver.service.spec.ts`

- [ ] **Step 1: Escrever o teste (banco tem prioridade; senão cai no env)**

`provider-key-resolver.service.spec.ts`:
```ts
import { ProviderKeyResolverService } from './provider-key-resolver.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { ConfigService } from '@nestjs/config';

const SECRET = 'a'.repeat(64);
const crypto = new CryptoService({ get: () => SECRET } as unknown as ConfigService);

function makeConfig(env: Record<string, string | undefined>) {
  return { get: (k: string) => env[k] } as unknown as ConfigService;
}

describe('ProviderKeyResolverService', () => {
  it('resolve do banco quando existe chave para a capability', async () => {
    const prisma = {
      aiProviderKey: {
        findFirst: jest.fn(async () => ({
          provider: 'GROQ', encryptedKey: crypto.encrypt('gsk_from_db'),
          baseUrl: null, model: 'whisper-large-v3-turbo',
        })),
      },
    };
    const svc = new ProviderKeyResolverService(prisma as any, crypto, makeConfig({}));
    const r = await svc.resolve('org1', 'TRANSCRIPTION');
    expect(r).toEqual({ provider: 'GROQ', apiKey: 'gsk_from_db', baseUrl: undefined, model: 'whisper-large-v3-turbo' });
  });

  it('cai no .env quando não há chave no banco', async () => {
    const prisma = { aiProviderKey: { findFirst: jest.fn(async () => null) } };
    const svc = new ProviderKeyResolverService(prisma as any, crypto, makeConfig({ GROQ_API_KEY: 'gsk_env' }));
    const r = await svc.resolve('org1', 'TRANSCRIPTION');
    expect(r).toEqual({ provider: 'GROQ', apiKey: 'gsk_env', baseUrl: undefined, model: undefined });
  });

  it('retorna null quando não há nem banco nem env', async () => {
    const prisma = { aiProviderKey: { findFirst: jest.fn(async () => null) } };
    const svc = new ProviderKeyResolverService(prisma as any, crypto, makeConfig({}));
    expect(await svc.resolve('org1', 'EMBEDDINGS')).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx jest src/modules/ai-provider-keys/provider-key-resolver.service.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar o resolver**

`provider-key-resolver.service.ts`:
```ts
import { Injectable } from '@nestjs/common';
import { AiCapability, AiProvider } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';

export interface ResolvedProviderKey {
  provider: AiProvider;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

const ENV_FALLBACK: Record<AiCapability, { provider: AiProvider; keyEnv: string; baseUrlEnv?: string }> = {
  TRANSCRIPTION: { provider: 'GROQ', keyEnv: 'GROQ_API_KEY' },
  EMBEDDINGS: { provider: 'OPENAI', keyEnv: 'OPENAI_API_KEY' },
  AGENT_LLM: { provider: 'SAKANA', keyEnv: 'SAKANA_API_KEY', baseUrlEnv: 'SAKANA_BASE_URL' },
};

@Injectable()
export class ProviderKeyResolverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService,
  ) {}

  async resolve(orgId: string, capability: AiCapability): Promise<ResolvedProviderKey | null> {
    const row = await this.prisma.aiProviderKey.findFirst({
      where: { organizationId: orgId, capabilities: { has: capability } },
      orderBy: { updatedAt: 'desc' },
      select: { provider: true, encryptedKey: true, baseUrl: true, model: true },
    });
    if (row) {
      return {
        provider: row.provider,
        apiKey: this.crypto.decrypt(row.encryptedKey),
        baseUrl: row.baseUrl ?? undefined,
        model: row.model ?? undefined,
      };
    }
    const fb = ENV_FALLBACK[capability];
    const envKey = this.config.get<string>(fb.keyEnv);
    if (!envKey) return null;
    return {
      provider: fb.provider,
      apiKey: envKey,
      baseUrl: fb.baseUrlEnv ? this.config.get<string>(fb.baseUrlEnv) ?? undefined : undefined,
      model: undefined,
    };
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx jest src/modules/ai-provider-keys/provider-key-resolver.service.spec.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/modules/ai-provider-keys/provider-key-resolver.service.ts src/modules/ai-provider-keys/provider-key-resolver.service.spec.ts
git commit -m "feat: ProviderKeyResolverService (banco + fallback .env)"
```

---

## Task 5: Ligar a transcrição ao resolver

**Files:**
- Modify: `src/modules/messaging/messages/transcription.service.ts`
- Modify: `src/modules/messaging/messaging.module.ts`

- [ ] **Step 1: Importar o AiProviderKeysModule no MessagingModule**

Em `messaging.module.ts`, adicionar `AiProviderKeysModule` ao array `imports`:
```ts
import { AiProviderKeysModule } from '../ai-provider-keys/ai-provider-keys.module';
// ...
imports: [/* ...existentes..., */ AiProviderKeysModule],
```

- [ ] **Step 2: Injetar o resolver e trocar a origem da chave**

Em `transcription.service.ts`:
- No constructor, adicionar:
```ts
    private readonly providerKeys: import('../../ai-provider-keys/provider-key-resolver.service').ProviderKeyResolverService,
```
  (ou import normal no topo: `import { ProviderKeyResolverService } from '../../ai-provider-keys/provider-key-resolver.service';` e `private readonly providerKeys: ProviderKeyResolverService`).
- Substituir o bloco:
```ts
    const apiKey = this.config.get<string>('GROQ_API_KEY');
    if (!apiKey) {
      throw new BadRequestException('GROQ_API_KEY not configured on the server');
    }
```
  por:
```ts
    const resolved = await this.providerKeys.resolve(organizationId, 'TRANSCRIPTION');
    if (!resolved) {
      throw new BadRequestException(
        'Nenhuma chave de transcrição configurada (cadastre em Configurações > Provedores IA)',
      );
    }
    const apiKey = resolved.apiKey;
    const isGroq = resolved.provider === 'GROQ';
    const apiUrl = isGroq
      ? 'https://api.groq.com/openai/v1/audio/transcriptions'
      : 'https://api.openai.com/v1/audio/transcriptions';
    const model = resolved.model ?? (isGroq ? 'whisper-large-v3-turbo' : 'whisper-1');
```
- Trocar os usos de `TranscriptionService.API_URL` por `apiUrl` e `TranscriptionService.MODEL` por `model` (na chamada `axios.post` e no `formData.append('model', ...)`).
- Atualizar o campo do resultado `provider: 'groq-whisper'` para refletir o provider real:
```ts
      provider: isGroq ? 'groq-whisper' : 'openai-whisper',
```
  e ampliar o tipo em `TranscriptionResult` para `provider: 'groq-whisper' | 'openai-whisper';`.

- [ ] **Step 3: Compilar**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: sem erros.

- [ ] **Step 4: Commit**

```bash
git add src/modules/messaging
git commit -m "feat: transcrição resolve a chave por org (banco + fallback env)"
```

---

## Task 6: Ligar os embeddings ao resolver

**Files:**
- Modify: `src/modules/ai-agents/rag/embeddings.service.ts`
- Modify: `src/modules/ai-agents/rag/indexer.processor.ts`
- Modify: `src/modules/ai-agents/rag/retrieval.service.ts`
- Modify: `src/modules/ai-agents/rag/rag.module.ts`

- [ ] **Step 1: Adicionar `orgId` à assinatura do embeddings e resolver a chave por chamada**

Em `embeddings.service.ts`:
- Injetar `ProviderKeyResolverService` no constructor (remover a leitura da chave no constructor).
- Mudar `embed(text: string)` → `embed(text: string, organizationId: string)` e
  `embedBatch(texts: string[])` → `embedBatch(texts: string[], organizationId: string)`.
- Dentro de cada método, antes do `fetch`:
```ts
    const resolved = await this.providerKeys.resolve(organizationId, 'EMBEDDINGS');
    if (!resolved) {
      throw new InternalServerErrorException(
        'Nenhuma chave de embeddings configurada (Configurações > Provedores IA)',
      );
    }
```
  e usar `Authorization: \`Bearer ${resolved.apiKey}\`` (a URL de embeddings continua OpenAI-compatível; se `resolved.provider` não for OPENAI, ainda assim usa o endpoint OpenAI — embeddings hoje só suportam OpenAI, então manter a URL fixa é aceitável).

- [ ] **Step 2: Passar `orgId` nos call sites**

- Em `indexer.processor.ts:85`: o processor recebe um job com dados do documento —
  usar o `organizationId` do payload do job. Trocar `this.embeddings.embed(content)`
  por `this.embeddings.embed(content, job.data.organizationId)` (confirmar o nome do
  campo no `job.data`; se não existir, incluí-lo ao enfileirar o job).
- Em `retrieval.service.ts:34`: `retrieve(input)` já recebe contexto de consulta —
  passar `input.organizationId` para `this.embeddings.embed(input.query, input.organizationId)`
  (confirmar que `input` carrega `organizationId`; se não, adicioná-lo à interface e ao chamador).

- [ ] **Step 3: Importar o AiProviderKeysModule no RagModule**

Em `rag.module.ts`, adicionar `AiProviderKeysModule` aos `imports`.

- [ ] **Step 4: Compilar e rodar testes de RAG existentes**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest src/modules/ai-agents/rag`
Expected: compila; testes existentes ajustados para a nova assinatura passam.

- [ ] **Step 5: Commit**

```bash
git add src/modules/ai-agents/rag
git commit -m "feat: embeddings resolvem a chave por org (banco + fallback env)"
```

---

## Task 7: Ligar o LLM dos agentes ao resolver (mais pesado)

**Files:**
- Modify: `src/modules/ai-agents/llm/llm.service.ts`
- Modify: `src/modules/ai-agents/llm/llm.module.ts`
- Modify: chamadores de `complete()` (ver Step 3)

- [ ] **Step 1: Introduzir cache de cliente por org**

Em `llm.service.ts`:
- Injetar `ProviderKeyResolverService`.
- Adicionar um `Map<string, { client: OpenAI; keyHash: string }>` e um método:
```ts
  private clients = new Map<string, { client: OpenAI; fingerprint: string }>();

  private async clientFor(orgId: string): Promise<OpenAI> {
    const resolved = await this.providerKeys.resolve(orgId, 'AGENT_LLM');
    if (!resolved) throw new InternalServerErrorException('Nenhuma chave de LLM configurada');
    const baseURL = resolved.baseUrl ?? this.config.get<string>('SAKANA_BASE_URL') ?? SAKANA_DEFAULT_BASE_URL;
    const fingerprint = `${resolved.apiKey}|${baseURL}`;
    const cached = this.clients.get(orgId);
    if (cached && cached.fingerprint === fingerprint) return cached.client;
    const client = new OpenAI({ apiKey: resolved.apiKey, baseURL, timeout: this.timeoutMs });
    this.clients.set(orgId, { client, fingerprint });
    return client;
  }
```
  (guardar `this.timeoutMs` no constructor a partir de `SAKANA_TIMEOUT_MS`.)

- [ ] **Step 2: `complete()` passa a exigir `organizationId`**

- Adicionar `organizationId: string` ao tipo `LlmCompletionRequest` (em `llm.types.ts`).
- No início de `complete()`, trocar `this.client` por `const client = await this.clientFor(req.organizationId);`
  e usar `client.chat.completions.create(...)`.
- Remover a checagem `this.hasApiKey`/`this.client` do constructor (ou manter só como aviso de boot).

- [ ] **Step 3: Atualizar todos os chamadores de `complete()`**

Run para listar os chamadores:
```bash
grep -rn "\.complete(" src/modules/ai-agents | grep -v node_modules
```
Para cada chamador (runner, classifier, memória, evals/runner, evals/judge), garantir
que o objeto passado a `complete()` inclua `organizationId`. Esses serviços já operam
no contexto de uma organização (conversa/agent run) — propague o `orgId` que eles já
possuem. Onde o `orgId` não estiver disponível na função, threa-lo a partir do
chamador imediato.

- [ ] **Step 4: Importar o AiProviderKeysModule no LlmModule**

Em `llm.module.ts`, adicionar `AiProviderKeysModule` aos `imports`.

- [ ] **Step 5: Compilar e rodar testes de ai-agents**

Run: `npx tsc --noEmit -p tsconfig.json && npx jest src/modules/ai-agents`
Expected: compila; testes ajustados passam.

- [ ] **Step 6: Commit**

```bash
git add src/modules/ai-agents/llm $(git diff --name-only | tr '\n' ' ')
git commit -m "feat: LLM dos agentes resolve a chave por org (cache de cliente)"
```

---

## Task 8: Frontend — service + página + aba

**Files:**
- Create: `chat-bullq-web/src/features/settings/services/ai-providers.service.ts`
- Create: `chat-bullq-web/src/app/(dashboard)/settings/ai-providers/page.tsx`
- Modify: `chat-bullq-web/src/app/(dashboard)/settings/layout.tsx`

- [ ] **Step 1: Criar o service do frontend**

`ai-providers.service.ts`:
```ts
import { api } from '@/lib/api';

export type AiProvider = 'GROQ' | 'OPENAI' | 'SAKANA';
export type AiCapability = 'TRANSCRIPTION' | 'EMBEDDINGS' | 'AGENT_LLM';

export interface AiProviderKey {
  id: string;
  name: string;
  provider: AiProvider;
  keyPreview: string;
  capabilities: AiCapability[];
  baseUrl: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertAiProviderKey {
  name: string;
  provider: AiProvider;
  key?: string;
  capabilities: AiCapability[];
  baseUrl?: string;
  model?: string;
}

export const aiProvidersService = {
  async list(): Promise<AiProviderKey[]> {
    const { data } = await api.get('/ai-provider-keys');
    return data.data;
  },
  async create(payload: UpsertAiProviderKey): Promise<AiProviderKey> {
    const { data } = await api.post('/ai-provider-keys', payload);
    return data.data;
  },
  async update(id: string, payload: Partial<UpsertAiProviderKey>): Promise<AiProviderKey> {
    const { data } = await api.patch(`/ai-provider-keys/${id}`, payload);
    return data.data;
  },
  async remove(id: string): Promise<void> {
    await api.delete(`/ai-provider-keys/${id}`);
  },
};
```

- [ ] **Step 2: Adicionar a aba na navegação**

Em `settings/layout.tsx`, importar um ícone (ex.: `BrainCircuit` de `lucide-react`) e
adicionar ao array `tabs`, logo após a aba `IA`:
```ts
  { href: '/settings/ai-providers', label: 'Provedores IA', icon: BrainCircuit },
```

- [ ] **Step 3: Criar a página**

`settings/ai-providers/page.tsx` — seguir o padrão de `settings/api-keys/page.tsx`
(client component, `useQuery(['ai-provider-keys', orgId])`, `useOrgId`, `sonner`
para toasts). Conteúdo:
- Cabeçalho: "Provedores de IA" + descrição ("Cadastre suas chaves e escolha o que
  cada uma faz. As chaves ficam criptografadas e nunca são exibidas de novo.").
- Botão "Adicionar chave" abre um modal com: `name` (input), `provider` (select
  GROQ/OPENAI/SAKANA), `key` (input tipo password), `capabilities` (3 checkboxes:
  Transcrição/Embeddings/LLM), `baseUrl` e `model` (inputs opcionais). Salva via
  `aiProvidersService.create`.
- Lista de chaves: por item, `name`, badge do `provider`, `code` com `keyPreview`,
  chips das `capabilities` (labels PT: Transcrição/Embeddings/LLM), botões editar
  (reabre o modal com os campos; `key` em branco mantém a atual) e excluir
  (`confirm` + `aiProvidersService.remove`).
- Estado vazio: ícone + "Nenhuma chave cadastrada".
- Após qualquer mutação: `queryClient.invalidateQueries({ queryKey: ['ai-provider-keys'] })`.

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, BrainCircuit, X } from 'lucide-react';
import { toast } from 'sonner';
import { aiProvidersService, type AiProviderKey, type AiCapability, type UpsertAiProviderKey } from '@/features/settings/services/ai-providers.service';
import { useOrgId } from '@/hooks/use-org-query-key';

const CAP_LABELS: Record<AiCapability, string> = {
  TRANSCRIPTION: 'Transcrição',
  EMBEDDINGS: 'Embeddings',
  AGENT_LLM: 'LLM',
};
const ALL_CAPS: AiCapability[] = ['TRANSCRIPTION', 'EMBEDDINGS', 'AGENT_LLM'];
const EMPTY: UpsertAiProviderKey = { name: '', provider: 'GROQ', key: '', capabilities: [] };

export default function AiProvidersPage() {
  const queryClient = useQueryClient();
  const orgId = useOrgId();
  const { data: keys, isLoading } = useQuery({ queryKey: ['ai-provider-keys', orgId], queryFn: () => aiProvidersService.list() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ai-provider-keys'] });

  const [editing, setEditing] = useState<AiProviderKey | null>(null);
  const [form, setForm] = useState<UpsertAiProviderKey | null>(null);

  const openCreate = () => { setEditing(null); setForm({ ...EMPTY }); };
  const openEdit = (k: AiProviderKey) => {
    setEditing(k);
    setForm({ name: k.name, provider: k.provider, key: '', capabilities: k.capabilities, baseUrl: k.baseUrl ?? '', model: k.model ?? '' });
  };
  const close = () => { setForm(null); setEditing(null); };

  const toggleCap = (c: AiCapability) => setForm((f) => f ? { ...f, capabilities: f.capabilities.includes(c) ? f.capabilities.filter((x) => x !== c) : [...f.capabilities, c] } : f);

  const save = async () => {
    if (!form) return;
    if (!form.name.trim()) return toast.error('Informe um nome');
    if (!editing && !form.key?.trim()) return toast.error('Informe a chave');
    try {
      if (editing) {
        const payload: Partial<UpsertAiProviderKey> = { name: form.name, provider: form.provider, capabilities: form.capabilities, baseUrl: form.baseUrl || undefined, model: form.model || undefined };
        if (form.key?.trim()) payload.key = form.key.trim();
        await aiProvidersService.update(editing.id, payload);
      } else {
        await aiProvidersService.create({ ...form, key: form.key!.trim(), baseUrl: form.baseUrl || undefined, model: form.model || undefined });
      }
      toast.success('Chave salva'); refresh(); close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar');
    }
  };

  const remove = async (k: AiProviderKey) => {
    if (!confirm(`Remover a chave "${k.name}"?`)) return;
    try { await aiProvidersService.remove(k.id); toast.success('Removida'); refresh(); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Erro ao remover'); }
  };

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Provedores de IA</h2>
          <p className="mt-0.5 text-sm text-zinc-500">Cadastre suas chaves e escolha o que cada uma faz. As chaves ficam criptografadas e não são exibidas de novo.</p>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Plus className="h-4 w-4" /> Adicionar chave
        </button>
      </div>

      <div className="mt-6 space-y-2">
        {isLoading ? (
          Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-lg border bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900" />)
        ) : !keys?.length ? (
          <div className="flex flex-col items-center py-12 text-center">
            <BrainCircuit className="h-10 w-10 text-zinc-200 dark:text-zinc-700" />
            <p className="mt-3 text-sm text-zinc-500">Nenhuma chave cadastrada</p>
          </div>
        ) : keys.map((k) => (
          <div key={k.id} className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{k.name}</span>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-zinc-500 dark:bg-zinc-800">{k.provider}</span>
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{k.keyPreview}</code>
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {k.capabilities.length ? k.capabilities.map((c) => (
                  <span key={c} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{CAP_LABELS[c]}</span>
                )) : <span className="text-xs text-zinc-400">Nenhuma função selecionada</span>}
              </div>
            </div>
            <div className="ml-3 flex items-center gap-1">
              <button onClick={() => openEdit(k)} className="rounded p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800" title="Editar"><Pencil className="h-3.5 w-3.5" /></button>
              <button onClick={() => remove(k)} className="rounded p-1.5 text-zinc-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20" title="Remover"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ))}
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{editing ? 'Editar chave' : 'Nova chave'}</h3>
              <button onClick={close} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 px-5 py-4">
              <Field label="Nome"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="Groq produção" /></Field>
              <Field label="Provedor">
                <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as any })} className={inputCls}>
                  <option value="GROQ">Groq</option><option value="OPENAI">OpenAI</option><option value="SAKANA">Sakana</option>
                </select>
              </Field>
              <Field label={editing ? 'Chave (deixe em branco para manter)' : 'Chave'}>
                <input type="password" value={form.key ?? ''} onChange={(e) => setForm({ ...form, key: e.target.value })} className={inputCls} placeholder="gsk_… / sk-…" />
              </Field>
              <Field label="Funções">
                <div className="flex flex-wrap gap-2">
                  {ALL_CAPS.map((c) => (
                    <label key={c} className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1.5 text-sm dark:border-zinc-700">
                      <input type="checkbox" checked={form.capabilities.includes(c)} onChange={() => toggleCap(c)} />
                      {CAP_LABELS[c]}
                    </label>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Base URL (opcional)"><input value={form.baseUrl ?? ''} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} className={inputCls} /></Field>
                <Field label="Modelo (opcional)"><input value={form.model ?? ''} onChange={(e) => setForm({ ...form, model: e.target.value })} className={inputCls} /></Field>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
              <button onClick={close} className="rounded-md px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancelar</button>
              <button onClick={save} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputCls = 'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (<div><label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</label>{children}</div>);
}
```

- [ ] **Step 4: Build do frontend**

Run (em `chat-bullq-web/`): `npm run build`
Expected: build sem erros de type/lint na nova página.

- [ ] **Step 5: Commit**

```bash
git add "chat-bullq-web/src/features/settings/services/ai-providers.service.ts" "chat-bullq-web/src/app/(dashboard)/settings/ai-providers/page.tsx" "chat-bullq-web/src/app/(dashboard)/settings/layout.tsx"
git commit -m "feat: tela de Provedores de IA em Configurações"
```

---

## Task 9: E2E do CRUD com guard de role

**Files:**
- Create: `chat-bullq-api/test/ai-provider-keys.e2e-spec.ts` (ou seguir o padrão dos e2e existentes em `test/`)

- [ ] **Step 1: Escrever o e2e**

Cobrir:
- OWNER cria uma chave `{ provider: GROQ, capabilities: [TRANSCRIPTION] }` → 201, resposta mascarada (sem a chave crua).
- `GET /ai-provider-keys` lista a chave com `keyPreview` e sem `encryptedKey`.
- Criar uma segunda chave com `TRANSCRIPTION` → a primeira perde `TRANSCRIPTION` (dono único).
- AGENT recebe 403 em `POST /ai-provider-keys`.
- `DELETE` remove a chave.

Seguir o setup dos e2e existentes na pasta `test/` (mesma app factory, mesmo login helper).

- [ ] **Step 2: Rodar o e2e**

Run: `npx jest --config test/jest-e2e.json test/ai-provider-keys.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/ai-provider-keys.e2e-spec.ts
git commit -m "test: e2e do CRUD de AI provider keys (dono único + guard de role)"
```

---

## Task 10: Fechamento

- [ ] **Step 1: Suíte completa + typecheck**

Run (em `chat-bullq-api/`): `npx tsc --noEmit -p tsconfig.json && npx jest`
Expected: verde.

- [ ] **Step 2: Verificação manual (opcional, com app rodando)**

Subir a stack, entrar como OWNER, abrir Configurações > Provedores IA, cadastrar a
chave Groq com "Transcrição", e transcrever um áudio para confirmar que resolve do
banco. Remover a chave e confirmar que volta ao fallback do `.env`.

- [ ] **Step 3: Finalização da branch**

Usar a skill `superpowers:finishing-a-development-branch` para decidir merge/PR.
```

