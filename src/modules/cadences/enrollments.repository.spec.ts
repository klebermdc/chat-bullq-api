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
});
