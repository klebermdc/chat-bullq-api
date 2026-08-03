import { ChannelsRepository } from './channels.repository';

const build = () => {
  const prisma = {
    channel: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const repository = new ChannelsRepository(prisma as any);
  return { prisma, repository };
};

describe('ChannelsRepository.findByTypeIncludingInactive', () => {
  it('NÃO filtra por isActive — canal desativado precisa ser visível', async () => {
    const { prisma, repository } = build();

    await repository.findByTypeIncludingInactive('WHATSAPP_OFFICIAL' as any);

    const where = prisma.channel.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ type: 'WHATSAPP_OFFICIAL', deletedAt: null });
    // se alguém re-adicionar isActive aqui, o gateway volta a não distinguir
    // "canal desativado" de "canal inexistente" e o alerta perde o diagnóstico
    expect(where.isActive).toBeUndefined();
  });

  it('ordena ativos primeiro para a seleção ser determinística', async () => {
    const { prisma, repository } = build();

    await repository.findByTypeIncludingInactive('WHATSAPP_OFFICIAL' as any);

    expect(prisma.channel.findMany.mock.calls[0][0].orderBy).toEqual([
      { isActive: 'desc' },
      { updatedAt: 'desc' },
    ]);
  });
});
