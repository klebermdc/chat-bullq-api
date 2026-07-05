import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { PrismaModule } from '../../database/prisma.module';
import { PrismaService } from '../../database/prisma.service';
import { CryptoModule } from '../../common/crypto/crypto.module';
import { AiProviderKeysService } from './ai-provider-keys.service';
import { ProviderKeyResolverService } from './provider-key-resolver.service';
import { AiProviderKeysController } from './ai-provider-keys.controller';
import { ROLES_KEY } from '../../common/decorators';

describe('AiProviderKeys integration', () => {
  let moduleRef: TestingModule;
  let service: AiProviderKeysService;
  let resolver: ProviderKeyResolverService;
  let prisma: PrismaService;
  const SLUG = 'itest-ai-provider-keys';
  let orgId: string;

  beforeAll(async () => {
    // NOTE: we intentionally do NOT import AiProviderKeysModule here.
    // AiProviderKeysController is decorated with @UseGuards(JwtAuthGuard,
    // OrgGuard, RolesGuard), and OrgGuard transitively depends on
    // ChannelAccessService -> ChannelAccessModule's controllers -> other
    // app-wide providers (e.g. RealtimeGateway), pulling in most of the
    // app just to satisfy DI even though no HTTP request is ever made
    // against the controller in this test. We only need the real
    // services (backed by the real Prisma/Crypto providers) plus the
    // controller's role metadata, which is read directly off the
    // prototype via Reflector — no controller instantiation required.
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, CryptoModule],
      providers: [AiProviderKeysService, ProviderKeyResolverService],
    }).compile();

    service = moduleRef.get(AiProviderKeysService);
    resolver = moduleRef.get(ProviderKeyResolverService);
    prisma = moduleRef.get(PrismaService);

    // idempotent cleanup then seed a throwaway org
    const existing = await prisma.organization.findUnique({ where: { slug: SLUG } });
    if (existing) {
      await prisma.aiProviderKey.deleteMany({ where: { organizationId: existing.id } });
      await prisma.organization.delete({ where: { id: existing.id } });
    }
    const org = await prisma.organization.create({
      data: { name: 'ITest AI Keys Org', slug: SLUG },
    });
    orgId = org.id;
  });

  afterAll(async () => {
    if (orgId) {
      await prisma.aiProviderKey.deleteMany({ where: { organizationId: orgId } });
      await prisma.organization.delete({ where: { id: orgId } }).catch(() => {});
    }
    await moduleRef?.close();
  });

  it('create masks the secret (no raw key, no encryptedKey)', async () => {
    const created = await service.create(orgId, {
      name: 'Groq',
      provider: 'GROQ',
      key: 'gsk_secret_ABC123',
      capabilities: ['TRANSCRIPTION', 'EMBEDDINGS'],
    });
    expect(JSON.stringify(created)).not.toContain('gsk_secret_ABC123');
    expect(created).not.toHaveProperty('encryptedKey');
    expect(created.keyPreview).toBeDefined();
  });

  it('single-owner: assigning TRANSCRIPTION to a new key removes it from the first, preserving other caps', async () => {
    await service.create(orgId, {
      name: 'Groq2',
      provider: 'GROQ',
      key: 'gsk_secret_XYZ',
      capabilities: ['TRANSCRIPTION'],
    });
    const all = await service.findAll(orgId);
    const first = all.find((k) => k.name === 'Groq');
    const second = all.find((k) => k.name === 'Groq2');
    expect(second?.capabilities).toContain('TRANSCRIPTION');
    expect(first?.capabilities).not.toContain('TRANSCRIPTION');
    expect(first?.capabilities).toContain('EMBEDDINGS');
    expect(JSON.stringify(all)).not.toContain('gsk_secret');
  });

  it('resolver decrypts the stored key for a capability', async () => {
    // EMBEDDINGS is owned by "Groq" key with value gsk_secret_ABC123
    const r = await resolver.resolve(orgId, 'EMBEDDINGS');
    expect(r).toBeTruthy();
    expect(r?.apiKey).toBe('gsk_secret_ABC123');
    expect(r?.provider).toBe('GROQ');
  });

  it('remove deletes the key', async () => {
    const all = await service.findAll(orgId);
    const target = all.find((k) => k.name === 'Groq2');
    expect(target).toBeDefined();
    await service.remove(orgId, target!.id);
    const after = await service.findAll(orgId);
    expect(after.find((k) => k.id === target!.id)).toBeUndefined();
  });

  it('controller endpoints require OWNER/ADMIN role', () => {
    const reflector = new Reflector();
    for (const method of ['list', 'create', 'update', 'remove']) {
      const roles = reflector.get(
        ROLES_KEY,
        AiProviderKeysController.prototype[method as keyof AiProviderKeysController],
      );
      expect(roles).toEqual(expect.arrayContaining([OrgRole.OWNER, OrgRole.ADMIN]));
    }
  });
});
