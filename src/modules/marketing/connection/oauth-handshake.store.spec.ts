import { ConfigService } from '@nestjs/config';
import { OAuthHandshakeStore, HANDSHAKE_TTL_SECONDS } from './oauth-handshake.store';

/** Fake mínimo de ioredis: só SET com EX, GET e DEL. */
function makeFakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: jest.fn(async (key: string, value: string, _ex: string, _ttl: number) => {
      store.set(key, value);
      return 'OK';
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    quit: jest.fn(async () => 'OK'),
  };
}

function build() {
  const redis = makeFakeRedis();
  const config = { get: () => undefined } as unknown as ConfigService;
  const store = new OAuthHandshakeStore(config);
  // Substitui o cliente real pelo fake, como os outros specs do projeto fazem.
  (store as any).redis = redis;
  return { store, redis };
}

const PAYLOAD = {
  tokenEnc: 'cifrado',
  expiresAt: '2026-10-01T00:00:00.000Z',
  accounts: [{ id: 'act_1', name: 'Conta 1', currency: 'BRL', timezoneName: null, businessId: null }],
};

describe('OAuthHandshakeStore', () => {
  it('devolve um handshakeId opaco, diferente a cada save', async () => {
    const { store } = build();
    const a = await store.save(PAYLOAD);
    const b = await store.save(PAYLOAD);
    expect(a).toEqual(expect.any(String));
    expect(a.length).toBeGreaterThan(20);
    expect(a).not.toBe(b);
  });

  it('nao coloca o token no proprio handshakeId', async () => {
    const { store } = build();
    const id = await store.save(PAYLOAD);
    expect(id).not.toContain('cifrado');
  });

  it('grava com TTL', async () => {
    const { store, redis } = build();
    await store.save(PAYLOAD);
    const [, , exFlag, ttl] = redis.set.mock.calls[0];
    expect(exFlag).toBe('EX');
    expect(ttl).toBe(HANDSHAKE_TTL_SECONDS);
  });

  it('consome devolvendo o payload', async () => {
    const { store } = build();
    const id = await store.save(PAYLOAD);
    await expect(store.consume(id)).resolves.toEqual(PAYLOAD);
  });

  it('consumir e destrutivo: a segunda vez devolve null', async () => {
    const { store } = build();
    const id = await store.save(PAYLOAD);
    await store.consume(id);
    await expect(store.consume(id)).resolves.toBeNull();
  });

  it('handshakeId desconhecido devolve null', async () => {
    const { store } = build();
    await expect(store.consume('nao-existe')).resolves.toBeNull();
  });

  it('payload corrompido devolve null em vez de explodir', async () => {
    const { store, redis } = build();
    const id = await store.save(PAYLOAD);
    redis.store.set(`marketing:oauth:${id}`, '{ isso nao e json');
    await expect(store.consume(id)).resolves.toBeNull();
  });
});
