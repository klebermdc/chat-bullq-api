import { AutomationResumeWatchdogCron } from './automation-resume-watchdog.cron';
import { AutomationRunStatus } from '@prisma/client';

describe('AutomationResumeWatchdogCron.claimAndEnqueueDueRuns', () => {
  const now = new Date('2026-07-09T12:00:00.000Z');

  function makeCron(dueRuns: any[]) {
    const prisma = {
      automationRun: {
        findMany: jest.fn().mockResolvedValue(dueRuns),
      },
    };
    const resumeQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const watchdogQueue = { add: jest.fn().mockResolvedValue(undefined) };
    const cron = new AutomationResumeWatchdogCron(
      prisma as any,
      resumeQueue as any,
      watchdogQueue as any,
    );
    return { cron, prisma, resumeQueue };
  }

  it('enfileira um job por run vencido', async () => {
    const { cron, resumeQueue, prisma } = makeCron([
      { id: 'run1', organizationId: 'org1' },
      { id: 'run2', organizationId: 'org1' },
    ]);
    const n = await cron.claimAndEnqueueDueRuns(now);
    expect(n).toBe(2);
    expect(prisma.automationRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: AutomationRunStatus.WAITING,
          resumeAt: { lte: now },
        }),
      }),
    );
    expect(resumeQueue.add).toHaveBeenCalledTimes(2);
    expect(resumeQueue.add).toHaveBeenCalledWith(
      'resume',
      { runId: 'run1', organizationId: 'org1' },
      expect.objectContaining({ jobId: 'resume:run1' }),
    );
  });

  it('não enfileira nada quando não há runs vencidos', async () => {
    const { cron, resumeQueue } = makeCron([]);
    const n = await cron.claimAndEnqueueDueRuns(now);
    expect(n).toBe(0);
    expect(resumeQueue.add).not.toHaveBeenCalled();
  });
});

describe('AutomationResumeWatchdogCron.sweepStaleRuns', () => {
  const now = new Date('2026-07-10T12:00:00.000Z');

  function makeCron(count: number) {
    const prisma = {
      automationRun: {
        updateMany: jest.fn().mockResolvedValue({ count }),
      },
    };
    const resumeQueue = { add: jest.fn() };
    const watchdogQueue = { add: jest.fn() };
    const cron = new AutomationResumeWatchdogCron(
      prisma as any,
      resumeQueue as any,
      watchdogQueue as any,
    );
    return { cron, prisma };
  }

  it('marca FAILED órfãs WAITING+resumeAt=null mais velhas que o threshold', async () => {
    const { cron, prisma } = makeCron(3);
    const n = await cron.sweepStaleRuns(now);
    expect(n).toBe(3);
    expect(prisma.automationRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: AutomationRunStatus.WAITING,
          resumeAt: null,
          startedAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) },
        }),
        data: expect.objectContaining({
          status: AutomationRunStatus.FAILED,
          errorCode: 'stale_in_progress',
        }),
      }),
    );
  });

  it('retorna 0 quando não há órfãs', async () => {
    const { cron } = makeCron(0);
    expect(await cron.sweepStaleRuns(now)).toBe(0);
  });
});
