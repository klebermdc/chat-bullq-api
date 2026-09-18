import { ContactResolverService } from './contact-resolver.service';

/**
 * O operador cria o contato digitando o celular COM o 9 (5511 98201-5967),
 * mas o WhatsApp identifica muitos celulares BR SEM ele. A resposta do
 * cliente chegava com o outro id, criava um 2º contato e caía numa conversa
 * que ninguém estava olhando — "a mensagem não chega".
 */
describe('ContactResolverService.resolve — 9º dígito', () => {
  function make(opts: { exact?: any; variant?: any } = {}) {
    const prisma = {
      contactChannel: {
        findUnique: jest.fn().mockResolvedValue(opts.exact ?? null),
        findFirst: jest.fn().mockResolvedValue(opts.variant ?? null),
        update: jest.fn().mockResolvedValue({}),
      },
      contact: {
        create: jest.fn().mockResolvedValue({ id: 'c-new', channels: [{ id: 'cc-new' }] }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as any;
    const idempotency = { withLock: jest.fn((_key: string, fn: () => any) => fn()) } as any;
    return { svc: new ContactResolverService(prisma, idempotency), prisma };
  }

  const inbound = (externalContactId: string) =>
    ({ externalContactId, contactName: 'João', contactPhone: '551182015967' }) as any;

  it('casa com o canal gravado com o 9 quando a resposta chega sem ele', async () => {
    const variant = {
      id: 'cc1', contactId: 'c-operador', externalId: '5511982015967@s.whatsapp.net',
      profileName: 'João', profileAvatarUrl: null, contact: { name: 'João', phone: '5511982015967' },
    };
    const { svc, prisma } = make({ variant });

    const res = await svc.resolve('org1', 'ch1', inbound('551182015967@s.whatsapp.net'));

    expect(res).toEqual({ contactId: 'c-operador', contactChannelId: 'cc1', isNew: false });
    expect(prisma.contactChannel.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { channelId: 'ch1', externalId: { in: ['5511982015967@s.whatsapp.net'] } },
    }));
    // Passa a usar o id que o WhatsApp usa: próximas mensagens caem no caminho rápido.
    expect(prisma.contactChannel.update).toHaveBeenCalledWith({
      where: { id: 'cc1' }, data: { externalId: '551182015967@s.whatsapp.net' },
    });
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  it('cria contato novo quando nenhuma forma do número existe', async () => {
    const { svc, prisma } = make();
    const res = await svc.resolve('org1', 'ch1', inbound('551182015967@s.whatsapp.net'));
    expect(res.isNew).toBe(true);
    expect(prisma.contact.create).toHaveBeenCalled();
  });

  it('não procura variante para id que não é telefone (@lid)', async () => {
    const { svc, prisma } = make();
    await svc.resolve('org1', 'ch1', inbound('123456789@lid'));
    expect(prisma.contactChannel.findFirst).not.toHaveBeenCalled();
    expect(prisma.contact.create).toHaveBeenCalled();
  });
});
