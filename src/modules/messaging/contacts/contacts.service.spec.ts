import { ContactsService } from './contacts.service';

describe('ContactsService.create', () => {
  const make = (overrides: Record<string, any> = {}) => {
    const repo = {
      findFirstByOrgPhone: jest.fn().mockResolvedValue(null),
      findByChannelExternal: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'new-contact' }),
      createWithChannel: jest.fn().mockResolvedValue({ id: 'c1', name: 'Ana', phone: '5511982015967' }),
      ...overrides,
    } as any;
    return { repo, svc: new ContactsService(repo) };
  };

  // --- cadastro manual (sem canal): dedup por (org, telefone) ---
  it('cria contato novo com telefone normalizado', async () => {
    const { svc, repo } = make();
    const res = await svc.create('org1', { name: 'João', phone: '+55 (11) 98201-5967' });
    expect(res).toEqual({ id: 'new-contact' });
    expect(repo.create).toHaveBeenCalledWith({ organizationId: 'org1', name: 'João', phone: '5511982015967', email: undefined });
  });

  it('nao duplica: retorna o existente por (org, phone)', async () => {
    const { svc, repo } = make({ findFirstByOrgPhone: jest.fn().mockResolvedValue({ id: 'exist1' }) });
    const res = await svc.create('org1', { name: 'X', phone: '5511982015967' });
    expect(res).toEqual({ id: 'exist1' });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('lanca em telefone invalido', async () => {
    const { svc } = make();
    await expect(svc.create('org1', { phone: '123' } as any)).rejects.toThrow();
  });

  // --- via canal (public API): dedup por (canal, telefone) ---
  it('cria contato novo vinculado a um canal', async () => {
    const { svc, repo } = make();
    const out = await svc.create('org1', { name: 'Ana', phone: '5511982015967', channelId: 'ch1' });
    expect(repo.createWithChannel).toHaveBeenCalledWith('org1', { name: 'Ana', phone: '5511982015967', channelId: 'ch1' });
    expect(out).toMatchObject({ id: 'c1' });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('é idempotente: se já existe contactChannel (canal, telefone), retorna o existente', async () => {
    const { svc, repo } = make({
      findByChannelExternal: jest.fn().mockResolvedValue({ contact: { id: 'existing', name: 'Ana' } }),
    });
    const out = await svc.create('org1', { name: 'Ana', phone: '5511982015967', channelId: 'ch1' });
    expect(repo.createWithChannel).not.toHaveBeenCalled();
    expect(out).toMatchObject({ id: 'existing' });
  });
});
