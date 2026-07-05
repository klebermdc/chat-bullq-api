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

  it('preview mascara a chave', () => {
    const svc = makeService(SECRET);
    expect(svc.preview('gsk_secret12345')).toBe('gsk_…12345');
  });
});
