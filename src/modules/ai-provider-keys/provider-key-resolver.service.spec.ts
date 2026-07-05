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

  it('AGENT_LLM cai no SAKANA_API_KEY + SAKANA_BASE_URL', async () => {
    const prisma = { aiProviderKey: { findFirst: jest.fn(async () => null) } };
    const svc = new ProviderKeyResolverService(prisma as any, crypto, makeConfig({ SAKANA_API_KEY: 'sk-sakana', SAKANA_BASE_URL: 'https://api.sakana.ai/v1' }));
    const r = await svc.resolve('org1', 'AGENT_LLM');
    expect(r).toEqual({ provider: 'SAKANA', apiKey: 'sk-sakana', baseUrl: 'https://api.sakana.ai/v1', model: undefined });
  });

  it('retorna null quando não há nem banco nem env', async () => {
    const prisma = { aiProviderKey: { findFirst: jest.fn(async () => null) } };
    const svc = new ProviderKeyResolverService(prisma as any, crypto, makeConfig({}));
    expect(await svc.resolve('org1', 'EMBEDDINGS')).toBeNull();
  });
});
