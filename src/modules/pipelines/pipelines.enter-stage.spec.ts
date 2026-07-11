import { PipelinesService } from './pipelines.service';

function makeService() {
  const prisma = {
    pipeline: { findFirst: jest.fn() },
    pipelineStage: { findFirst: jest.fn() },
    card: { findFirst: jest.fn() },
  } as any;
  const realtime = { emitToOrg: jest.fn() } as any;
  const cadenceRunner = {
    maybeStartForStage: jest.fn().mockResolvedValue(null),
  } as any;
  const service = new PipelinesService(prisma, realtime, cadenceRunner);
  return { service, prisma, realtime, cadenceRunner };
}

const opts = { pipelineName: 'Vendas OFP', stageName: 'Proposta enviada' };

describe('PipelinesService.enterStageForConversation', () => {
  it('pipeline não encontrado → no-op', async () => {
    const { service, prisma, cadenceRunner } = makeService();
    prisma.pipeline.findFirst.mockResolvedValue(null);
    const move = jest.spyOn(service, 'moveCard').mockResolvedValue(undefined as any);
    const create = jest.spyOn(service, 'createCard').mockResolvedValue(undefined as any);

    await service.enterStageForConversation('conv-1', 'org-1', opts);

    expect(move).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(cadenceRunner.maybeStartForStage).not.toHaveBeenCalled();
  });

  it('etapa não encontrada → no-op', async () => {
    const { service, prisma } = makeService();
    prisma.pipeline.findFirst.mockResolvedValue({ id: 'pipe-1' });
    prisma.pipelineStage.findFirst.mockResolvedValue(null);
    const move = jest.spyOn(service, 'moveCard').mockResolvedValue(undefined as any);

    await service.enterStageForConversation('conv-1', 'org-1', opts);

    expect(move).not.toHaveBeenCalled();
  });

  it('card já na etapa → idempotente (não move)', async () => {
    const { service, prisma, cadenceRunner } = makeService();
    prisma.pipeline.findFirst.mockResolvedValue({ id: 'pipe-1' });
    prisma.pipelineStage.findFirst.mockResolvedValue({ id: 'stage-ps' });
    prisma.card.findFirst.mockResolvedValue({ id: 'card-1', stageId: 'stage-ps' });
    const move = jest.spyOn(service, 'moveCard').mockResolvedValue(undefined as any);

    await service.enterStageForConversation('conv-1', 'org-1', opts);

    expect(move).not.toHaveBeenCalled();
    expect(cadenceRunner.maybeStartForStage).not.toHaveBeenCalled();
  });

  it('card em outra etapa → move para a etapa alvo', async () => {
    const { service, prisma } = makeService();
    prisma.pipeline.findFirst.mockResolvedValue({ id: 'pipe-1' });
    prisma.pipelineStage.findFirst.mockResolvedValue({ id: 'stage-ps' });
    prisma.card.findFirst.mockResolvedValue({ id: 'card-1', stageId: 'stage-coleta' });
    const move = jest.spyOn(service, 'moveCard').mockResolvedValue(undefined as any);

    await service.enterStageForConversation('conv-1', 'org-1', opts);

    expect(move).toHaveBeenCalledWith('card-1', 'org-1', {
      toStageId: 'stage-ps',
      toIndex: 0,
    });
  });

  it('sem card → cria na etapa e dispara cadência', async () => {
    const { service, prisma, cadenceRunner } = makeService();
    prisma.pipeline.findFirst.mockResolvedValue({ id: 'pipe-1' });
    prisma.pipelineStage.findFirst.mockResolvedValue({ id: 'stage-ps' });
    prisma.card.findFirst.mockResolvedValue(null);
    const create = jest
      .spyOn(service, 'createCard')
      .mockResolvedValue({ id: 'card-new' } as any);

    await service.enterStageForConversation('conv-1', 'org-1', opts);

    expect(create).toHaveBeenCalledWith('pipe-1', 'org-1', {
      conversationId: 'conv-1',
      stageId: 'stage-ps',
    });
    expect(cadenceRunner.maybeStartForStage).toHaveBeenCalledWith(
      'conv-1',
      'card-new',
      'stage-ps',
      'org-1',
    );
  });
});
