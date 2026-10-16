import { CONTRACT_CALENDAR_SELECT, ContractsRepository } from './contracts.repository';

function make() {
  const prisma = { contract: { findMany: jest.fn().mockResolvedValue([]) } } as any;
  return { repo: new ContractsRepository(prisma), prisma };
}

describe('ContractsRepository.findForCalendar', () => {
  it('filtra pela org e pelo escopo do ator, só com os campos da agenda', async () => {
    const { repo, prisma } = make();
    await repo.findForCalendar('org1', { createdById: 'u1' });
    expect(prisma.contract.findMany).toHaveBeenCalledWith({
      where: { AND: [{ createdById: 'u1' }], organizationId: 'org1' },
      orderBy: { createdAt: 'asc' },
      select: CONTRACT_CALENDAR_SELECT,
    });
  });

  it('com guia, compara sem diferenciar maiúsculas', async () => {
    const { repo, prisma } = make();
    await repo.findForCalendar('org1', {}, 'kleber');
    expect(prisma.contract.findMany.mock.calls[0][0].where).toEqual({
      AND: [{}],
      organizationId: 'org1',
      guideName: { equals: 'kleber', mode: 'insensitive' },
    });
  });

  it('não seleciona CPF, e-mail, endereço, valor nem token', () => {
    for (const field of ['cpf', 'email', 'address', 'cep', 'amount', 'acceptanceToken', 'pixKey']) {
      expect(CONTRACT_CALENDAR_SELECT).not.toHaveProperty(field);
    }
  });
});
