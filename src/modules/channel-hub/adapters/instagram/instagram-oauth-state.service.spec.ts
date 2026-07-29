import { OrgRole } from '@prisma/client';
import { InstagramOAuthStateService } from './instagram-oauth-state.service';
import { InstagramPlatformConfigService } from './instagram-platform-config.service';

describe('InstagramOAuthStateService', () => {
  const platform = new InstagramPlatformConfigService();
  let redis: { set: jest.Mock };
  let svc: InstagramOAuthStateService;

  const payload = {
    organizationId: 'org_1',
    userOrganizationId: 'uo_1',
    role: OrgRole.OWNER,
    returnTo: 'https://sendtur.com.br/settings/channels',
  };

  beforeEach(() => {
    process.env.IG_STATE_SECRET = 'segredo-de-teste';
    process.env.IG_RETURN_ALLOWLIST = 'sendtur.com.br';
    // SETNX bem-sucedido devolve 'OK'; nonce já usado devolve null.
    redis = { set: jest.fn().mockResolvedValue('OK') };
    svc = new InstagramOAuthStateService(platform, redis as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('assina e verifica ida e volta', async () => {
    const state = svc.sign(payload);
    await expect(svc.verify(state)).resolves.toMatchObject({
      organizationId: 'org_1',
      userOrganizationId: 'uo_1',
      role: OrgRole.OWNER,
      returnTo: 'https://sendtur.com.br/settings/channels',
    });
  });

  it('rejeita assinatura adulterada', async () => {
    const state = svc.sign(payload);
    const [body] = state.split('.');
    await expect(svc.verify(`${body}.deadbeef`)).rejects.toThrow(/state/i);
  });

  it('rejeita assinatura multibyte sem estourar RangeError', async () => {
    const state = svc.sign(payload);
    const [body] = state.split('.');
    await expect(svc.verify(`${body}.${'é'.repeat(64)}`)).rejects.toThrow(/assinatura/i);
  });

  it('rejeita payload adulterado', async () => {
    const state = svc.sign(payload);
    const [, sig] = state.split('.');
    const forged = Buffer.from(
      JSON.stringify({ ...payload, organizationId: 'org_INVASOR', nonce: 'n', exp: Date.now() + 1000 }),
    ).toString('base64url');
    await expect(svc.verify(`${forged}.${sig}`)).rejects.toThrow(/state/i);
  });

  it.each(['null', '[]', '"texto"'])(
    'rejeita payload que nao e objeto (%s) sem estourar TypeError',
    async (json) => {
      const crypto = require('crypto');
      const body = Buffer.from(json).toString('base64url');
      const sig = crypto
        .createHmac('sha256', process.env.IG_STATE_SECRET)
        .update(body)
        .digest('hex');
      await expect(svc.verify(`${body}.${sig}`)).rejects.toThrow(/ilegivel/i);
    },
  );

  it('rejeita state expirado', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const state = svc.sign(payload);
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + 11 * 60 * 1000);
    await expect(svc.verify(state)).rejects.toThrow(/expirad/i);
  });

  it('o mesmo state nao passa duas vezes', async () => {
    const usados = new Set<string>();
    redis.set.mockImplementation(async (key: string) =>
      usados.has(key) ? null : (usados.add(key), 'OK'),
    );
    const state = svc.sign(payload);
    await expect(svc.verify(state)).resolves.toBeTruthy();
    await expect(svc.verify(state)).rejects.toThrow(/uma vez|reus/i);
  });

  it('sign() gera nonces diferentes a cada chamada', () => {
    const state1 = svc.sign(payload);
    const state2 = svc.sign(payload);
    expect(state1).not.toEqual(state2);
  });

  it('recusa assinar ou verificar com IG_STATE_SECRET vazio', async () => {
    process.env.IG_STATE_SECRET = '';
    const semSegredo = new InstagramOAuthStateService(platform, redis as any);
    expect(() => semSegredo.sign(payload)).toThrow(/IG_STATE_SECRET/);
    await expect(semSegredo.verify('a.b')).rejects.toThrow(/IG_STATE_SECRET/);
  });

  it('rejeita returnTo fora da allowlist', async () => {
    const state = svc.sign({ ...payload, returnTo: 'https://evil.example.com/x' });
    await expect(svc.verify(state)).rejects.toThrow(/returnTo|destino/i);
  });

  it('rejeita returnTo sem https', async () => {
    const state = svc.sign({ ...payload, returnTo: 'http://sendtur.com.br/x' });
    await expect(svc.verify(state)).rejects.toThrow(/https|destino/i);
  });

  it('queima o nonce com TTL e flag NX', async () => {
    const state = svc.sign(payload);
    await svc.verify(state);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringMatching(/^ig:oauth:nonce:/),
      '1',
      'EX',
      600,
      'NX',
    );
  });
});
