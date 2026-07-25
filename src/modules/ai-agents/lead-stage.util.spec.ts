import { enterLeadStage } from './lead-stage.util';

function makePrisma(existingCard: { id: string; stageId: string } | null) {
  return {
    pipeline: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'pl1',
        stages: [
          { id: 's-distrib', name: 'Distribuir' },
          { id: 's-col', name: 'Coletando Informação' },
        ],
      }),
    },
    card: {
      findFirst: jest.fn().mockResolvedValue(existingCard),
      aggregate: jest.fn().mockResolvedValue({ _max: { order: 2 } }),
      update: jest.fn().mockResolvedValue({}),
      create: jest
        .fn()
        .mockResolvedValue({ id: 'card-new', pipelineId: 'pl1', stageId: 's-distrib' }),
    },
    contact: { findUnique: jest.fn().mockResolvedValue({ name: 'João' }) },
  } as any;
}

describe('enterLeadStage — emite realtime pro Kanban atualizar ao vivo', () => {
  const realtime = { emitToOrg: jest.fn() } as any;
  beforeEach(() => realtime.emitToOrg.mockClear());

  it('ao MOVER um card existente de etapa → emite card:moved', async () => {
    const prisma = makePrisma({ id: 'card1', stageId: 's-old' });
    await enterLeadStage(prisma, realtime, {
      conversationId: 'c1',
      organizationId: 'org1',
      stageContains: 'distribu',
    });
    expect(prisma.card.update).toHaveBeenCalled();
    expect(realtime.emitToOrg).toHaveBeenCalledWith(
      'org1',
      'card:moved',
      expect.objectContaining({
        cardId: 'card1',
        pipelineId: 'pl1',
        fromStageId: 's-old',
        toStageId: 's-distrib',
      }),
    );
  });

  it('ao CRIAR um card novo → emite card:created', async () => {
    const prisma = makePrisma(null);
    await enterLeadStage(prisma, realtime, {
      conversationId: 'c1',
      organizationId: 'org1',
      contactId: 'ct1',
      stageContains: 'distribu',
    });
    expect(prisma.card.create).toHaveBeenCalled();
    expect(realtime.emitToOrg).toHaveBeenCalledWith(
      'org1',
      'card:created',
      expect.objectContaining({ card: expect.objectContaining({ id: 'card-new' }) }),
    );
  });

  it('no-op (card já está na etapa alvo) → NÃO emite nada', async () => {
    const prisma = makePrisma({ id: 'card1', stageId: 's-distrib' });
    await enterLeadStage(prisma, realtime, {
      conversationId: 'c1',
      organizationId: 'org1',
      stageContains: 'distribu',
    });
    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(realtime.emitToOrg).not.toHaveBeenCalled();
  });

  it('pipeline/etapa inexistente → retorna null e NÃO emite', async () => {
    const prisma = makePrisma(null);
    prisma.pipeline.findFirst.mockResolvedValue(null);
    const r = await enterLeadStage(prisma, realtime, {
      conversationId: 'c1',
      organizationId: 'org1',
      stageContains: 'distribu',
    });
    expect(r).toBeNull();
    expect(realtime.emitToOrg).not.toHaveBeenCalled();
  });
});
