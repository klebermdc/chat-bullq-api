import { UnauthorizedException } from '@nestjs/common';
import { NfseApiKeyGuard, sameApiKey } from './nfse-api-key.guard';

function contextWith(headers: Record<string, unknown>) {
  return { switchToHttp: () => ({ getRequest: () => ({ headers }) }) } as any;
}

function guardWith(key: string | undefined) {
  return new NfseApiKeyGuard({ get: () => key } as any);
}

describe('NfseApiKeyGuard', () => {
  it('lets the right key through', () => {
    expect(guardWith('segredo').canActivate(contextWith({ 'x-api-key': 'segredo' }))).toBe(true);
  });

  it('rejects a wrong key with 401', () => {
    expect(() => guardWith('segredo').canActivate(contextWith({ 'x-api-key': 'outro' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a request without the header', () => {
    expect(() => guardWith('segredo').canActivate(contextWith({}))).toThrow(UnauthorizedException);
  });

  it('rejects everything when the secret is not configured', () => {
    expect(() => guardWith(undefined).canActivate(contextWith({ 'x-api-key': '' }))).toThrow(
      UnauthorizedException,
    );
  });
});

describe('sameApiKey', () => {
  it('compares keys of different lengths without throwing', () => {
    expect(sameApiKey('a', 'abc')).toBe(false);
    expect(sameApiKey('abc', 'abc')).toBe(true);
  });
});
