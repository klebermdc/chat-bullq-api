import { CONTRACT_CALENDAR_SELECT, ContractsRepository } from './contracts.repository';

function make() {
  const prisma = { contract: { findMany: jest.fn().mockResolvedValue([]) } } as any;
  return { repo: new ContractsRepository(prisma), prisma };
}

describe('ContractsRepository.findForCalendar', () => {
  it('filtra pela org, pelo escopo do ator e por criados até 400 dias antes de from', async () => {
    const { repo, prisma } = make();
    await repo.findForCalendar('org1', { createdById: 'u1' }, '2026-11-01');
    expect(prisma.contract.findMany).toHaveBeenCalledWith({
      where: {
        AND: [{ createdById: 'u1' }],
        organizationId: 'org1',
        createdAt: { gte: new Date('2025-09-27T00:00:00.000Z') },
      },
      orderBy: { createdAt: 'asc' },
      select: CONTRACT_CALENDAR_SELECT,
    });
  });

  it('com guia, compara sem diferenciar maiúsculas', async () => {
    const { repo, prisma } = make();
    await repo.findForCalendar('org1', {}, '2026-11-01', 'kleber');
    expect(prisma.contract.findMany.mock.calls[0][0].where).toEqual({
      AND: [{}],
      organizationId: 'org1',
      createdAt: { gte: new Date('2025-09-27T00:00:00.000Z') },
      guideName: { equals: 'kleber', mode: 'insensitive' },
    });
  });

  it('não seleciona CPF, e-mail, endereço, valor nem token', () => {
    for (const field of ['cpf', 'email', 'address', 'cep', 'amount', 'acceptanceToken', 'pixKey']) {
      expect(CONTRACT_CALENDAR_SELECT).not.toHaveProperty(field);
    }
  });
});
