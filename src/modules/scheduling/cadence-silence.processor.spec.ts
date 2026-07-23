import { CadenceSilenceProcessor } from './cadence-silence.processor';

const WINDOW = 1440;
const WINDOW_MS = WINDOW * 60_000;

function make() {
  const enrollments = {
    findById: jest.fn(),
    finishIfLive: jest.fn().mockResolvedValue(true),
  };
  const cadences = { findById: jest.fn() };
  const prisma = {
    card: { findUnique: jest.fn() },
    message: { findFirst: jest.fn() },
  };
  const runner = { resumeAtStep: jest.fn() };
  const queue = { add: jest.fn().mockResolvedValue({ id: 'j' }) };
  const realtime = { emitToConversation: jest.fn() };
  const autoReengage = { nextAllowedTime: jest.fn((d: Date) => d) };
  const proc: any = new CadenceSilenceProcessor(
    enrollments as any, cadences as any, prisma as any, runner as any,
    queue as any, realtime as any, autoReengage as any,
  );
  return { proc, enrollments, cadences, prisma, runner, queue, autoReengage };
}

const NOW = new Date('2026-07-16T12:00:00Z').getTime();
beforeAll(() => jest.spyOn(Date, 'now').mockReturnValue(NOW));
afterAll(() => (Date.now as any).mockRestore?.());

const baseEnrollment = {
  id: 'e1', status: 'PAUSED', conversationId: 'c1', cardId: 'card1', cadenceId: 'cad1', currentStep: 2,
};
const baseCadence = { id: 'cad1', stageId: 'stageProp', silenceWindowMinutes: WINDOW };

it('no-op quando não está mais PAUSED', async () => {
  const { proc, enrollments, runner } = make();
  enrollments.findById.mockResolvedValue({ ...baseEnrollment, status: 'HANDED_OFF' });
  await proc.process({ data: { enrollmentId: 'e1' } } as any);
  expect(runner.resumeAtStep).not.toHaveBeenCalled();
});

it('cancela quando o card saiu da etapa gatilho', async () => {
  const { proc, enrollments, cadences, prisma, runner } = make();
  enrollments.findById.mockResolvedValue(baseEnrollment);
  cadences.findById.mockResolvedValue(baseCadence);
  prisma.card.findUnique.mockResolvedValue({ id: 'card1', stageId: 'OUTRA' });
  await proc.process({ data: { enrollmentId: 'e1' } } as any);
  expect(enrollments.finishIfLive).toHaveBeenCalledWith('e1', expect.objectContaining({ endReason: 'stage_changed' }));
  expect(runner.resumeAtStep).not.toHaveBeenCalled();
});

it('rearma quando há mensagem recente (silêncio insuficiente)', async () => {
  const { proc, enrollments, cadences, prisma, runner, queue } = make();
  enrollments.findById.mockResolvedValue(baseEnrollment);
  cadences.findById.mockResolvedValue(baseCadence);
  prisma.card.findUnique.mockResolvedValue({ id: 'card1', stageId: 'stageProp' });
  const recent = new Date(NOW - 60 * 60_000);
  prisma.message.findFirst.mockResolvedValue({ createdAt: recent });
  await proc.process({ data: { enrollmentId: 'e1' } } as any);
  expect(runner.resumeAtStep).not.toHaveBeenCalled();
  const expectedDelay = recent.getTime() + WINDOW_MS - NOW;
  expect(queue.add).toHaveBeenCalledWith(
    'check-cadence-silence', { enrollmentId: 'e1' },
    expect.objectContaining({ delay: expectedDelay }),
  );
});

it('retoma quando houve silêncio suficiente', async () => {
  const { proc, enrollments, cadences, prisma, runner, autoReengage } = make();
  enrollments.findById.mockResolvedValue(baseEnrollment);
  cadences.findById.mockResolvedValue(baseCadence);
  prisma.card.findUnique.mockResolvedValue({ id: 'card1', stageId: 'stageProp' });
  const old = new Date(NOW - (WINDOW + 60) * 60_000);
  prisma.message.findFirst.mockResolvedValue({ createdAt: old });
  await proc.process({ data: { enrollmentId: 'e1' } } as any);
  expect(autoReengage.nextAllowedTime).toHaveBeenCalled();
  expect(runner.resumeAtStep).toHaveBeenCalledWith('e1', expect.any(Date));
});
