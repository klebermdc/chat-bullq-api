import { EnrollmentsRepository } from './enrollments.repository';

describe('EnrollmentsRepository — PAUSED claims', () => {
  let prisma: any;
  let repo: EnrollmentsRepository;

  beforeEach(() => {
    prisma = { cadenceEnrollment: { updateMany: jest.fn(), findFirst: jest.fn() } };
    repo = new EnrollmentsRepository(prisma);
  });

  it('pauseIfActive só grava quando ACTIVE (compare-and-set)', async () => {
    prisma.cadenceEnrollment.updateMany.mockResolvedValue({ count: 1 });
    const ok = await repo.pauseIfActive('e1', { status: 'PAUSED' } as any);
    expect(ok).toBe(true);
    expect(prisma.cadenceEnrollment.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', status: 'ACTIVE' },
      data: { status: 'PAUSED' },
    });
  });

  it('pauseIfActive retorna false quando perdeu a corrida', async () => {
    prisma.cadenceEnrollment.updateMany.mockResolvedValue({ count: 0 });
    expect(await repo.pauseIfActive('e1', { status: 'PAUSED' } as any)).toBe(false);
  });

  it('resumeIfPaused só grava quando PAUSED', async () => {
    prisma.cadenceEnrollment.updateMany.mockResolvedValue({ count: 1 });
    const ok = await repo.resumeIfPaused('e1', { status: 'ACTIVE' } as any);
    expect(ok).toBe(true);
    expect(prisma.cadenceEnrollment.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', status: 'PAUSED' },
      data: { status: 'ACTIVE' },
    });
  });

  it('finishIfLive grava quando ACTIVE ou PAUSED', async () => {
    prisma.cadenceEnrollment.updateMany.mockResolvedValue({ count: 1 });
    const ok = await repo.finishIfLive('e1', { status: 'HANDED_OFF' } as any);
    expect(ok).toBe(true);
    expect(prisma.cadenceEnrollment.updateMany).toHaveBeenCalledWith({
      where: { id: 'e1', status: { in: ['ACTIVE', 'PAUSED'] } },
      data: { status: 'HANDED_OFF' },
    });
  });

  it('findLiveByConversation busca ACTIVE ou PAUSED', async () => {
    prisma.cadenceEnrollment.findFirst.mockResolvedValue({ id: 'e1' });
    await repo.findLiveByConversation('c1');
    expect(prisma.cadenceEnrollment.findFirst).toHaveBeenCalledWith({
      where: { conversationId: 'c1', status: { in: ['ACTIVE', 'PAUSED'] } },
    });
  });

  // Regressão do selo sumido: o header lê este finder. Só-ACTIVE fazia a
  // cadência pausada desaparecer do header e parecer morta.
  it('findLiveWithCadence traz PAUSED junto com a cadência', async () => {
    prisma.cadenceEnrollment.findFirst.mockResolvedValue({ id: 'e1' });
    await repo.findLiveWithCadence('c1');
    expect(prisma.cadenceEnrollment.findFirst).toHaveBeenCalledWith({
      where: { conversationId: 'c1', status: { in: ['ACTIVE', 'PAUSED'] } },
      include: {
        cadence: { include: { steps: { orderBy: { order: 'asc' } } } },
      },
    });
  });
});

describe('EnrollmentsRepository.create — desempate do P2002', () => {
  const { Prisma } = jest.requireActual('@prisma/client');

  function makeRepo(existing: any) {
    const p2002 = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: '6',
    });
    const prisma: any = {
      cadenceEnrollment: {
        create: jest.fn().mockRejectedValue(p2002),
        findFirst: jest.fn().mockResolvedValue(existing),
      },
    };
    return { repo: new EnrollmentsRepository(prisma), prisma };
  }

  // O índice único parcial cobre ACTIVE+PAUSED. Buscando só ACTIVE, o
  // desempate vinha vazio e o P2002 vazava como 500 pro atendente.
  it('P2002 com enrollment PAUSED → devolve o existente em vez de estourar', async () => {
    const { repo, prisma } = makeRepo({ id: 'enrPaused', status: 'PAUSED' });

    const result = await repo.create({ conversationId: 'c1' } as any);

    expect(result).toMatchObject({ id: 'enrPaused' });
    expect(prisma.cadenceEnrollment.findFirst).toHaveBeenCalledWith({
      where: { conversationId: 'c1', status: { in: ['ACTIVE', 'PAUSED'] } },
    });
  });

  it('P2002 sem enrollment vivo → propaga o erro', async () => {
    const { repo } = makeRepo(null);
    await expect(repo.create({ conversationId: 'c1' } as any)).rejects.toThrow();
  });
});
