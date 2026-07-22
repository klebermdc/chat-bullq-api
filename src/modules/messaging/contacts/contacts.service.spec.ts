import { OrgRole } from '@prisma/client';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
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
  it('cria contato novo com telefone normalizado e notes', async () => {
    const { svc, repo } = make();
    const res = await svc.create('org1', { name: 'João', phone: '+55 (11) 98201-5967', notes: 'lead' });
    expect(res).toEqual({ id: 'new-contact' });
    expect(repo.create).toHaveBeenCalledWith({ organizationId: 'org1', name: 'João', phone: '5511982015967', email: undefined, notes: 'lead' });
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

describe('ContactsService.findOne — escopo por atribuição na relação conversations', () => {
  const make = (found: unknown) => {
    const repo = { findById: jest.fn().mockResolvedValue(found) } as any;
    return { repo, svc: new ContactsService(repo) };
  };

  it('AGENT: repassa o próprio userId como scopedUserId pro repositório', async () => {
    const { svc, repo } = make({ id: 'c1', organizationId: 'org1' });
    await svc.findOne('c1', 'org1', OrgRole.AGENT, 'agent-u1');
    expect(repo.findById).toHaveBeenCalledWith('c1', 'agent-u1');
  });

  it('ADMIN: NÃO escopa (scopedUserId undefined)', async () => {
    const { svc, repo } = make({ id: 'c1', organizationId: 'org1' });
    await svc.findOne('c1', 'org1', OrgRole.ADMIN, 'admin-u1');
    expect(repo.findById).toHaveBeenCalledWith('c1', undefined);
  });

  it('chamador de sistema (sem currentUserId) não escopa', async () => {
    const { svc, repo } = make({ id: 'c1', organizationId: 'org1' });
    await svc.findOne('c1', 'org1');
    expect(repo.findById).toHaveBeenCalledWith('c1', undefined);
  });

  it('contato inexistente → NotFound', async () => {
    const { svc } = make(null);
    await expect(svc.findOne('c1', 'org1', OrgRole.AGENT, 'agent-u1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('contato de outra org → Forbidden', async () => {
    const { svc } = make({ id: 'c1', organizationId: 'outra-org' });
    await expect(svc.findOne('c1', 'org1', OrgRole.AGENT, 'agent-u1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
