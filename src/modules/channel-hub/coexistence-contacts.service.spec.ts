import { CoexistenceContactsService } from './coexistence-contacts.service';

describe('CoexistenceContactsService', () => {
  function make(link: any = null) {
    const prisma = {
      contactChannel: {
        findUnique: jest.fn().mockResolvedValue(link),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      contact: {
        findUnique: jest.fn().mockResolvedValue({ metadata: { origem: 'anuncio', ctwa: 'X1' } }),
        create: jest.fn().mockResolvedValue({ id: 'new-contact' }),
        update: jest.fn().mockResolvedValue({}),
        delete: jest.fn(),
      },
    } as any;
    const channel = { id: 'ch1', organizationId: 'org1' } as any;
    return { svc: new CoexistenceContactsService(prisma), prisma, channel };
  }

  it('cria contato novo a partir da agenda, antes de existir conversa', async () => {
    const { svc, prisma, channel } = make(null);
    await svc.handle(channel, { phone: '5511999', fullName: 'Maria Silva', action: 'add' });

    expect(prisma.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org1',
        name: 'Maria Silva',
        phone: '5511999',
      }),
    });
    expect(prisma.contactChannel.create).toHaveBeenCalled();
  });

  it('atualiza o nome de contato ja existente', async () => {
    const { svc, prisma, channel } = make({ contactId: 'c1' });
    await svc.handle(channel, { phone: '5511999', fullName: 'Maria S. Silva', action: 'update' });

    expect(prisma.contact.create).not.toHaveBeenCalled();
    expect(prisma.contact.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { name: 'Maria S. Silva' },
    });
  });

  // Apagar seria destrutivo: o contato tem conversa, card de lead e historico.
  // Sumir da agenda do celular nao encerra a relacao comercial.
  it('remocao na agenda NAO apaga o contato — so marca', async () => {
    const { svc, prisma, channel } = make({ contactId: 'c1' });
    await svc.handle(channel, { phone: '5511999', action: 'remove' });

    expect(prisma.contact.delete).not.toHaveBeenCalled();
    const data = prisma.contact.update.mock.calls[0][0].data;
    expect(data.metadata.smbRemovedAt).toBeDefined();
    // MERGE, nao substituicao: o que ja estava no metadata TEM que sobreviver.
    expect(data.metadata.origem).toBe('anuncio');
    expect(data.metadata.ctwa).toBe('X1');
  });

  it('remocao de contato que nunca existiu aqui e no-op', async () => {
    const { svc, prisma, channel } = make(null);
    await svc.handle(channel, { phone: '5511999', action: 'remove' });
    expect(prisma.contact.update).not.toHaveBeenCalled();
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  it('usa firstName quando nao vem fullName', async () => {
    const { svc, prisma, channel } = make(null);
    await svc.handle(channel, { phone: '5511999', firstName: 'Maria', action: 'add' });
    expect(prisma.contact.create.mock.calls[0][0].data.name).toBe('Maria');
  });
});
