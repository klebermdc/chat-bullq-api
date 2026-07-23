import { SonaxSettingsService } from './sonax-settings.service';

describe('SonaxSettingsService', () => {
  const crypto = { encrypt: (s: string) => `enc(${s})`, decrypt: (s: string) => s.replace(/^enc\(|\)$/g, '') } as any;
  const rows: any[] = [];
  const prisma = {
    sonaxSettings: {
      findUnique: jest.fn(async ({ where }) => rows.find((r) => r.organizationId === where.organizationId) || null),
      upsert: jest.fn(async ({ where, create, update }) => {
        const i = rows.findIndex((r) => r.organizationId === where.organizationId);
        if (i >= 0) { rows[i] = { ...rows[i], ...update }; return rows[i]; }
        const row = { id: 'ss1', ...create }; rows.push(row); return row;
      }),
    },
  } as any;

  beforeEach(() => { rows.length = 0; });

  it('upsert criptografa o token e gera webhookSecret na criação', async () => {
    const svc = new SonaxSettingsService(prisma, crypto);
    const saved = await svc.upsert('org1', { enabled: true, idCliente: '12345', token: 'TK20' });
    expect(saved.tokenEnc).toBe('enc(TK20)');
    expect(saved.webhookSecret).toHaveLength(40);
  });

  it('upsert preserva webhookSecret existente e não troca token quando ausente', async () => {
    const svc = new SonaxSettingsService(prisma, crypto);
    const first = await svc.upsert('org1', { enabled: true, idCliente: '12345', token: 'TK20' });
    const second = await svc.upsert('org1', { enabled: false, idCliente: '12345' });
    expect(second.webhookSecret).toBe(first.webhookSecret);
    expect(second.tokenEnc).toBe('enc(TK20)');
  });

  it('getDecryptedForDial devolve token em claro só para uso interno', async () => {
    const svc = new SonaxSettingsService(prisma, crypto);
    await svc.upsert('org1', { enabled: true, idCliente: '12345', token: 'TK20' });
    const d = await svc.getDecryptedForDial('org1');
    expect(d?.token).toBe('TK20');
  });
});
