import { OrgRole } from '@prisma/client';
import { PipelinesService } from './pipelines.service';

/**
 * O AGENT não pode marcar Ganho nem Pedido enviado numa conversa alheia
 * só porque conhece o conversationId. `markWonForConversation` e
 * `markOrderSentForConversation` compõem o mesmo `pipelineCardScopeWhere`
 * usado por `assertCardAccess` (Task 8) na busca do card por conversationId.
 */
function makeService(overrides: {
  card?: unknown;
  wonStage?: unknown;
  stage?: unknown;
} = {}) {
  const prisma: any = {
    card: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.card === undefined
          ? { id: 'card-1', pipelineId: 'pipe-1', metadata: {} }
          : overrides.card,
      ),
      update: jest.fn().mockResolvedValue({ id: 'card-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    pipelineStage: {
      findFirst: jest.fn().mockImplementation((args: any) => {
        // markWon busca por type: WON; markOrderSent busca por name contains.
        if (args?.where?.type === 'WON') {
          return Promise.resolve(
            overrides.wonStage === undefined
              ? { id: 'stage-won', type: 'WON' }
              : overrides.wonStage,
          );
        }
        return Promise.resolve(
          overrides.stage === undefined
            ? { id: 'stage-final', pipelineId: 'pipe-1' }
            : overrides.stage,
        );
      }),
    },
  };
  const realtime = { emitToOrg: jest.fn() } as any;
  const cadenceRunner = { maybeStartForStage: jest.fn() } as any;
  const metaCapiQueue = { enqueuePurchase: jest.fn() } as any;
  const svc = new PipelinesService(
    prisma,
    realtime,
    cadenceRunner,
    metaCapiQueue,
  );
  jest.spyOn(svc, 'moveCard').mockResolvedValue({ id: 'card-1' } as any);
  return { svc, prisma };
}

describe('PipelinesService.markWonForConversation — escopo por conversationId', () => {
  it('AGENT: busca o card com o OR de escopo mesclado', async () => {
    const { svc, prisma } = makeService();
    await svc.markWonForConversation(
      'o1',
      'conv-1',
      undefined,
      OrgRole.AGENT,
      'u1',
    );
    expect(prisma.card.findFirst).toHaveBeenCalledWith({
      where: {
        conversationId: 'conv-1',
        organizationId: 'o1',
        OR: [{ conversation: { assignedToId: 'u1' } }, { assignedToId: 'u1' }],
      },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('ADMIN: busca o card SEM cláusula de escopo', async () => {
    const { svc, prisma } = makeService();
    await svc.markWonForConversation(
      'o1',
      'conv-1',
      undefined,
      OrgRole.ADMIN,
      'u1',
    );
    expect(prisma.card.findFirst).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', organizationId: 'o1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('chamador de sistema (sem currentUserId): busca sem cláusula de escopo', async () => {
    const { svc, prisma } = makeService();
    await svc.markWonForConversation('o1', 'conv-1', 'PED-1');
    expect(prisma.card.findFirst).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', organizationId: 'o1' },
      orderBy: { createdAt: 'desc' },
    });
  });
});

describe('PipelinesService.markOrderSentForConversation — escopo por conversationId', () => {
  it('AGENT: busca o card com o OR de escopo mesclado', async () => {
    const { svc, prisma } = makeService();
    await svc.markOrderSentForConversation(
      'o1',
      'conv-1',
      undefined,
      OrgRole.AGENT,
      'u1',
    );
    expect(prisma.card.findFirst).toHaveBeenCalledWith({
      where: {
        pipelineId: 'pipe-1',
        conversationId: 'conv-1',
        OR: [{ conversation: { assignedToId: 'u1' } }, { assignedToId: 'u1' }],
      },
    });
  });

  it('ADMIN: busca o card SEM cláusula de escopo', async () => {
    const { svc, prisma } = makeService();
    await svc.markOrderSentForConversation(
      'o1',
      'conv-1',
      undefined,
      OrgRole.ADMIN,
      'u1',
    );
    expect(prisma.card.findFirst).toHaveBeenCalledWith({
      where: { pipelineId: 'pipe-1', conversationId: 'conv-1' },
    });
  });

  it('chamador de sistema (sem currentUserId): busca sem cláusula de escopo', async () => {
    const { svc, prisma } = makeService();
    await svc.markOrderSentForConversation('o1', 'conv-1');
    expect(prisma.card.findFirst).toHaveBeenCalledWith({
      where: { pipelineId: 'pipe-1', conversationId: 'conv-1' },
    });
  });
});

describe('PipelinesService.listCardsByConversation — escopo por conversationId', () => {
  it('AGENT: lista com o OR de escopo mesclado', async () => {
    const { svc, prisma } = makeService();
    await svc.listCardsByConversation('conv-1', 'o1', OrgRole.AGENT, 'u1');
    const call = prisma.card.findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      conversationId: 'conv-1',
      organizationId: 'o1',
      OR: [{ conversation: { assignedToId: 'u1' } }, { assignedToId: 'u1' }],
    });
  });

  it('ADMIN: lista SEM cláusula de escopo', async () => {
    const { svc, prisma } = makeService();
    await svc.listCardsByConversation('conv-1', 'o1', OrgRole.ADMIN, 'u1');
    const call = prisma.card.findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      conversationId: 'conv-1',
      organizationId: 'o1',
    });
  });

  it('chamador de sistema (sem currentUserId): lista sem cláusula de escopo', async () => {
    const { svc, prisma } = makeService();
    await svc.listCardsByConversation('conv-1', 'o1');
    const call = prisma.card.findMany.mock.calls[0][0];
    expect(call.where).toEqual({
      conversationId: 'conv-1',
      organizationId: 'o1',
    });
  });
});
