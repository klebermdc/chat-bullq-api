import { ContactsService } from './contacts.service';

describe('ContactsService.create', () => {
  function make(existing: any = null) {
    const repo = {
      findFirstByOrgPhone: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue({ id: 'new-contact' }),
    } as any;
    return { svc: new ContactsService(repo), repo };
  }
  it('cria contato novo com telefone normalizado', async () => {
    const { svc, repo } = make(null);
    const res = await svc.create('org1', { name: 'João', phone: '+55 (11) 98201-5967' });
    expect(res).toEqual({ id: 'new-contact' });
    expect(repo.create).toHaveBeenCalledWith({ organizationId: 'org1', name: 'João', phone: '5511982015967', email: undefined });
  });
  it('nao duplica: retorna o existente por (org, phone)', async () => {
    const { svc, repo } = make({ id: 'exist1' });
    const res = await svc.create('org1', { name: 'X', phone: '5511982015967' });
    expect(res).toEqual({ id: 'exist1' });
    expect(repo.create).not.toHaveBeenCalled();
  });
  it('lanca em telefone invalido', async () => {
    const { svc } = make(null);
    await expect(svc.create('org1', { phone: '123' } as any)).rejects.toThrow();
  });
});
