import { DelayedError } from 'bullmq';
import { MysteryShopperProcessor } from './mystery-shopper.processor';

function build(outcome: unknown) {
  const service = { sweep: jest.fn().mockResolvedValue('swept') };
  const evaluator = { evaluate: jest.fn().mockResolvedValue('DONE') };
  const botTurn = { run: jest.fn().mockResolvedValue(outcome), markFailed: jest.fn().mockResolvedValue(undefined) };
  const processor = new MysteryShopperProcessor(service as never, evaluator as never, botTurn as never, {} as never);
  return { processor, service, evaluator, botTurn };
}

describe('MysteryShopperProcessor', () => {
  it('roteia bot-turn para o serviço do robô', async () => {
    const { processor, botTurn, service, evaluator } = build({ kind: 'SENT' });
    await expect(processor.process({ name: 'bot-turn', data: { runId: 'r1' } } as never, 'tok')).resolves.toBe('SENT');
    expect(botTurn.run).toHaveBeenCalledWith('r1');
    expect(service.sweep).not.toHaveBeenCalled();
    expect(evaluator.evaluate).not.toHaveBeenCalled();
  });

  it('turno fora do horário atrasa o mesmo job e sinaliza DelayedError', async () => {
    const { processor } = build({ kind: 'DELAYED', delayMs: 3_600_000 });
    const job = { name: 'bot-turn', data: { runId: 'r1' }, moveToDelayed: jest.fn().mockResolvedValue(undefined) };
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
    try {
      await expect(processor.process(job as never, 'tok')).rejects.toBeInstanceOf(DelayedError);
      expect(job.moveToDelayed).toHaveBeenCalledWith(3_601_000, 'tok');
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('erro no turno marca a execução FAILED e repassa o erro; DelayedError não', async () => {
    const { processor, botTurn } = build({ kind: 'SENT' });
    botTurn.run.mockRejectedValue(new Error('boom'));
    await expect(processor.process({ name: 'bot-turn', data: { runId: 'r1' } } as never, 'tok')).rejects.toThrow('boom');
    expect(botTurn.markFailed).toHaveBeenCalledWith('r1', 'boom');

    botTurn.markFailed.mockClear();
    botTurn.run.mockResolvedValue({ kind: 'DELAYED', delayMs: 1 });
    const job = { name: 'bot-turn', data: { runId: 'r1' }, moveToDelayed: jest.fn().mockResolvedValue(undefined) };
    await expect(processor.process(job as never, 'tok')).rejects.toBeInstanceOf(DelayedError);
    expect(botTurn.markFailed).not.toHaveBeenCalled();
  });

  it('avaliação e varredura seguem como antes', async () => {
    const { processor, evaluator, service } = build({ kind: 'SENT' });
    await processor.process({ name: 'evaluate', data: { visitId: 'v1' } } as never);
    await processor.process({ name: 'sweep', data: {} } as never);
    expect(evaluator.evaluate).toHaveBeenCalledWith('v1');
    expect(service.sweep).toHaveBeenCalled();
  });
});
