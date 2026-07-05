import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { AiCapability, AiProvider } from '@prisma/client';
import { AiProviderKeysService } from './ai-provider-keys.service';
import { CryptoService } from '../../common/crypto/crypto.service';

const SECRET = 'a'.repeat(64);

function makeCrypto() {
  const config = {
    get: (k: string) => (k === 'KEY_ENCRYPTION_SECRET' ? SECRET : undefined),
  } as unknown as ConfigService;
  return new CryptoService(config);
}

/** Fake mínimo de PrismaService, operando sobre um array em memória. */
function makeFakePrisma() {
  const rows: any[] = [];
  let seq = 0;

  function applySelect(row: any, select?: Record<string, boolean>) {
    if (!select) return { ...row };
    const out: any = {};
    for (const key of Object.keys(select)) {
      if (select[key]) out[key] = row[key];
    }
    return out;
  }

  const aiProviderKey = {
    create: jest.fn(async ({ data, select }: any) => {
      const row = {
        id: `k${++seq}`,
        capabilities: [],
        baseUrl: null,
        model: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      };
      rows.push(row);
      return applySelect(row, select);
    }),
    findMany: jest.fn(async ({ where, select }: any) => {
      let result = rows;
      if (where?.organizationId !== undefined) {
        result = result.filter((r) => r.organizationId === where.organizationId);
      }
      if (where?.id?.not !== undefined) {
        result = result.filter((r) => r.id !== where.id.not);
      }
      return result.map((r) => applySelect(r, select));
    }),
    findFirst: jest.fn(async ({ where, select }: any) => {
      const found = rows.find(
        (r) => r.id === where.id && r.organizationId === where.organizationId,
      );
      return found ? applySelect(found, select) : null;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => r.id === where.id);
      if (!row) throw new Error('row not found');
      Object.assign(row, data);
      row.updatedAt = new Date();
      return { ...row };
    }),
    delete: jest.fn(async ({ where }: any) => {
      const idx = rows.findIndex((r) => r.id === where.id);
      if (idx === -1) throw new Error('row not found');
      const [removed] = rows.splice(idx, 1);
      return removed;
    }),
  };

  return { aiProviderKey, rows };
}

function build() {
  const prisma = makeFakePrisma();
  const crypto = makeCrypto();
  const service = new AiProviderKeysService(prisma as any, crypto);
  return { prisma, crypto, service };
}

describe('AiProviderKeysService', () => {
  it('aplica a regra de dono único: nova capability em B remove a mesma capability de A, mantendo as demais', async () => {
    const { service } = build();

    const keyA = await service.create('org1', {
      name: 'Groq A',
      provider: AiProvider.GROQ,
      key: 'gsk_key_a_1234567890',
      capabilities: [AiCapability.TRANSCRIPTION, AiCapability.EMBEDDINGS],
    } as any);

    const keyB = await service.create('org1', {
      name: 'Groq B',
      provider: AiProvider.GROQ,
      key: 'gsk_key_b_1234567890',
      capabilities: [AiCapability.TRANSCRIPTION],
    } as any);

    const all = await service.findAll('org1');
    const foundA = all.find((r) => r.id === keyA.id)!;
    const foundB = all.find((r) => r.id === keyB.id)!;

    expect(foundB.capabilities).toEqual([AiCapability.TRANSCRIPTION]);
    expect(foundA.capabilities).toEqual([AiCapability.EMBEDDINGS]);
    expect(foundA.capabilities).not.toContain(AiCapability.TRANSCRIPTION);
  });

  it('findAll nunca retorna a chave crua nem encryptedKey; keyPreview bate com crypto.preview', async () => {
    const { service, crypto } = build();
    const rawKey = 'gsk_super_secret_raw_value_999';

    await service.create('org1', {
      name: 'Groq',
      provider: AiProvider.GROQ,
      key: rawKey,
      capabilities: [AiCapability.AGENT_LLM],
    } as any);

    const all = await service.findAll('org1');
    expect(all).toHaveLength(1);
    const row: any = all[0];

    expect(row.encryptedKey).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain(rawKey);
    expect(row.keyPreview).toBe(crypto.preview(rawKey));
  });

  it('update com nova key troca o keyPreview; update sem key mantém o keyPreview anterior', async () => {
    const { service } = build();

    const created = await service.create('org1', {
      name: 'Groq',
      provider: AiProvider.GROQ,
      key: 'gsk_original_key_value_111',
      capabilities: [AiCapability.EMBEDDINGS],
    } as any);
    const originalPreview = created.keyPreview;

    const updatedNoKey = await service.update('org1', created.id, {
      name: 'Groq renomeada',
    } as any);
    expect(updatedNoKey.keyPreview).toBe(originalPreview);

    const updatedWithKey = await service.update('org1', created.id, {
      key: 'gsk_brand_new_key_value_222',
    } as any);
    expect(updatedWithKey.keyPreview).not.toBe(originalPreview);
  });

  it('remove exclui a chave (não aparece mais em findAll); findOne em id inexistente lança NotFoundException', async () => {
    const { service } = build();

    const created = await service.create('org1', {
      name: 'Groq',
      provider: AiProvider.GROQ,
      key: 'gsk_to_be_removed_key_333',
      capabilities: [],
    } as any);

    await service.remove('org1', created.id);

    const all = await service.findAll('org1');
    expect(all.find((r) => r.id === created.id)).toBeUndefined();

    await expect(service.update('org1', created.id, { name: 'x' } as any)).rejects.toThrow(
      NotFoundException,
    );
  });
});
