import { Prisma } from '@prisma/client';
import { LostRecoveryService } from './lost-recovery.service';
import {
  LOST_RECOVERY_PIPELINE_KEY,
  LOST_RECOVERY_STAGES,
} from './lost-recovery.constants';

const STAGES = LOST_RECOVERY_STAGES.map((s, order) => ({
  id: `stage-${s.key}`,
  key: s.key,
  order,
}));
const PIPELINE = { id: 'pipe-rec', stages: STAGES };

function makeService(opts: {
  pipeline?: unknown;
  card?: unknown;
  createError?: unknown;
} = {}) {
  const prisma: any = {
    pipeline: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce(opts.pipeline === undefined ? PIPELINE : opts.pipeline)
        .mockResolvedValue(PIPELINE),
      create: opts.createError
        ? jest.fn().mockRejectedValue(opts.createError)
        : jest.fn().mockResolvedValue({ id: 'pipe-rec' }),
    },
    pipelineStage: {
      findFirst: jest.fn().mockResolvedValue({ id: 'stage-recovered' }),
    },
    card: {
      findFirst: jest.fn().mockResolvedValue(opts.card === undefined ? null : opts.card),
    },
    cadenceEnrollment: {
      findFirst: jest.fn().mockResolvedValue({ id: 'enr-1' }),
    },
  };
  const pipelines = {
    createCard: jest.fn().mockResolvedValue({ id: 'rec-1' }),
    moveCard: jest.fn().mockResolvedValue({}),
    removeCard: jest.fn().mockResolvedValue({}),
  } as any;
  const cadenceRunner = {
    maybeStartForStage: jest.fn().mockResolvedValue(null),
    stop: jest.fn().mockResolvedValue(null),
  } as any;
  const svc = new LostRecoveryService(prisma, pipelines, cadenceRunner);
  return { svc, prisma, pipelines, cadenceRunner };
}

const CONV = { id: 'conv-1', assignedToId: 'u1' };

describe('LostRecoveryService.place', () => {
  it('sem card: cria na coluna do motivo e dispara a cadência dela', async () => {
    const { svc, pipelines, cadenceRunner } = makeService();

    const placement = await svc.place('o1', CONV, 'COMPETITOR', 'CVC');

    expect(pipelines.createCard).toHaveBeenCalledWith('pipe-rec', 'o1', {
      conversationId: 'conv-1',
      stageId: 'stage-COMPETITOR',
      assignedToId: 'u1',
      description: 'Comprou com concorrente: CVC',
    });
    expect(cadenceRunner.maybeStartForStage).toHaveBeenCalledWith(
      'conv-1',
      'rec-1',
      'stage-COMPETITOR',
      'o1',
    );
    expect(placement).toEqual({ cardId: 'rec-1', created: true, fromStageId: null });
  });

  it('card já no funil (perdido de novo): move e guarda a coluna anterior', async () => {
    const { svc, pipelines } = makeService({
      card: { id: 'rec-9', stageId: 'stage-recovered', pipelineId: 'pipe-rec' },
    });

    const placement = await svc.place('o1', CONV, 'NO_REPLY', null);

    expect(pipelines.createCard).not.toHaveBeenCalled();
    expect(pipelines.moveCard).toHaveBeenCalledWith('rec-9', 'o1', {
      toStageId: 'stage-NO_REPLY',
      toIndex: 0,
    });
    expect(placement).toEqual({
      cardId: 'rec-9',
      created: false,
      fromStageId: 'stage-recovered',
    });
  });

  it('cria o funil no primeiro uso, com todas as etapas NORMAL', async () => {
    const { svc, prisma } = makeService({ pipeline: null });

    await svc.place('o1', CONV, 'PRICE', null);

    const data = prisma.pipeline.create.mock.calls[0][0].data;
    expect(data.key).toBe(LOST_RECOVERY_PIPELINE_KEY);
    expect(data.stages.create.map((s: any) => s.key)).toEqual([
      'NO_REPLY',
      'JUST_BROWSING',
      'COMPETITOR',
      'PRICE',
      'TRIP_CANCELLED',
      'OTHER',
      'recovered',
      'discarded',
    ]);
    expect(new Set(data.stages.create.map((s: any) => s.type))).toEqual(new Set(['NORMAL']));
  });

  it('dois pedidos criando o funil ao mesmo tempo: usa o que já existe', async () => {
    const race = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: 'test',
    });
    const { svc, pipelines } = makeService({ pipeline: null, createError: race });

    await svc.place('o1', CONV, 'PRICE', null);

    expect(pipelines.createCard).toHaveBeenCalledWith(
      'pipe-rec',
      'o1',
      expect.objectContaining({ stageId: 'stage-PRICE' }),
    );
  });

  it('coluna do motivo apagada pelo operador: cai na primeira coluna', async () => {
    const { svc, pipelines } = makeService({
      pipeline: { id: 'pipe-rec', stages: STAGES.filter((s) => s.key !== 'PRICE') },
    });

    await svc.place('o1', CONV, 'PRICE', null);

    expect(pipelines.createCard.mock.calls[0][2].stageId).toBe('stage-NO_REPLY');
  });
});

describe('LostRecoveryService.undo', () => {
  it('apaga o card que a marcação criou', async () => {
    const { svc, prisma, pipelines } = makeService();
    prisma.card.findFirst.mockResolvedValue({ id: 'rec-1' });

    await svc.undo('o1', { cardId: 'rec-1', created: true, fromStageId: null });

    expect(pipelines.removeCard).toHaveBeenCalledWith('rec-1', 'o1');
  });

  it('devolve à coluna anterior quando o card já existia', async () => {
    const { svc, prisma, pipelines } = makeService();
    prisma.card.findFirst.mockResolvedValue({ id: 'rec-9' });

    await svc.undo('o1', { cardId: 'rec-9', created: false, fromStageId: 'stage-recovered' });

    expect(pipelines.moveCard).toHaveBeenCalledWith('rec-9', 'o1', {
      toStageId: 'stage-recovered',
      toIndex: 0,
    });
  });
});

describe('LostRecoveryService.markRecovered', () => {
  it('move o card de recuperação para Recuperado', async () => {
    const { svc, pipelines } = makeService({
      card: { id: 'rec-1', stageId: 'stage-PRICE', pipelineId: 'pipe-rec' },
    });

    await svc.markRecovered('o1', 'conv-1');

    expect(pipelines.moveCard).toHaveBeenCalledWith('rec-1', 'o1', {
      toStageId: 'stage-recovered',
      toIndex: 0,
    });
  });

  it('sem card de recuperação, não faz nada', async () => {
    const { svc, pipelines } = makeService();

    await svc.markRecovered('o1', 'conv-1');

    expect(pipelines.moveCard).not.toHaveBeenCalled();
  });
});

describe('LostRecoveryService.stopRecoveryCadence', () => {
  it('encerra a cadência ligada ao card de recuperação', async () => {
    const { svc, prisma, cadenceRunner } = makeService({
      card: { id: 'rec-1', stageId: 'stage-PRICE', pipelineId: 'pipe-rec' },
    });

    await svc.stopRecoveryCadence('o1', 'conv-1');

    expect(prisma.cadenceEnrollment.findFirst).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', cardId: 'rec-1', status: { in: ['ACTIVE', 'PAUSED'] } },
      select: { id: true },
    });
    expect(cadenceRunner.stop).toHaveBeenCalledWith('enr-1', 'won');
  });

  it('erro aqui não derruba o Ganho', async () => {
    const { svc, prisma } = makeService();
    prisma.card.findFirst.mockRejectedValue(new Error('db fora'));

    await expect(svc.stopRecoveryCadence('o1', 'conv-1')).resolves.toBeUndefined();
    await expect(svc.markRecovered('o1', 'conv-1')).resolves.toBeUndefined();
  });
});
