import { ContactResolverService } from './contact-resolver.service';

/**
 * O operador cria o contato digitando o celular COM o 9 (5511 98201-5967),
 * mas o WhatsApp identifica muitos celulares BR SEM ele. A resposta do
 * cliente chegava com o outro id, criava um 2º contato e caía numa conversa
 * que ninguém estava olhando — "a mensagem não chega".
 */
describe('ContactResolverService.resolve — 9º dígito', () => {
  function make(opts: { exact?: any; variant?: any; byPhone?: any } = {}) {
    const prisma = {
      contactChannel: {
        findUnique: jest.fn().mockResolvedValue(opts.exact ?? null),
        findFirst: jest.fn().mockResolvedValue(opts.variant ?? null),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 'cc-linked' }),
      },
      contact: {
        findFirst: jest.fn().mockResolvedValue(opts.byPhone ?? null),
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

  // Duas mensagens simultâneas, uma com cada forma do número, não podem criar
  // dois contatos: a trava tem que ser a mesma para as duas formas.
  it('usa a mesma trava para as duas formas do 9º dígito', async () => {
    const a = make();
    await a.svc.resolve('org1', 'ch1', inbound('551182015967@s.whatsapp.net'));
    const b = make();
    await b.svc.resolve('org1', 'ch1', inbound('5511982015967@s.whatsapp.net'));
    const keyOf = (svc: any) => svc.idempotency.withLock.mock.calls[0][0];
    expect(keyOf(a.svc)).toBe(keyOf(b.svc));
  });

  it('não procura variante para id que não é telefone (@lid)', async () => {
    const { svc, prisma } = make();
    await svc.resolve('org1', 'ch1', inbound('123456789@lid'));
    expect(prisma.contactChannel.findFirst).not.toHaveBeenCalled();
    expect(prisma.contact.create).toHaveBeenCalled();
  });

  // Contato que já existe na org mas nunca falou por ESTE canal (importado da
  // Umbler, ou cliente que muda de número de atendimento): tem que ser
  // reconhecido pelo telefone, senão nasce um contato duplicado sem as
  // etiquetas e sem o histórico.
  it('reaproveita contato da org pelo telefone quando não há vínculo neste canal', async () => {
    const byPhone = { id: 'c-importado', name: 'Maria', phone: '5511982015967' };
    const { svc, prisma } = make({ byPhone });

    const res = await svc.resolve('org1', 'ch1', inbound('551182015967@s.whatsapp.net'));

    expect(res).toEqual({ contactId: 'c-importado', contactChannelId: 'cc-linked', isNew: false });
    expect(prisma.contact.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: 'org1',
        phone: { in: ['551182015967', '5511982015967'] },
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(prisma.contactChannel.create).toHaveBeenCalledWith({
      data: {
        contactId: 'c-importado',
        channelId: 'ch1',
        externalId: '551182015967@s.whatsapp.net',
        profileName: 'João',
        profileAvatarUrl: undefined,
      },
    });
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  it('não procura por telefone quando a mensagem não traz telefone (Instagram)', async () => {
    const { svc, prisma } = make();

    await svc.resolve('org1', 'ch1', { externalContactId: 'ig-123', contactName: 'Ana' } as any);

    expect(prisma.contact.findFirst).not.toHaveBeenCalled();
    expect(prisma.contact.create).toHaveBeenCalled();
  });
});
