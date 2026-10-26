import { BadRequestException } from '@nestjs/common';
import { ConversationStatus, OrgRole } from '@prisma/client';
import { LostSaleService } from './lost-sale.service';

const ACTOR = { userId: 'u1', role: OrgRole.AGENT, access: 'ALL' as const };

function makeService(opts: {
  conversation?: Record<string, unknown>;
  card?: Record<string, unknown> | null;
  lostStage?: Record<string, unknown> | null;
  fromStage?: Record<string, unknown> | null;
} = {}) {
  const conversation = {
    id: 'conv-1',
    channelId: 'ch-1',
    contactId: 'ct-1',
    status: ConversationStatus.OPEN,
    metadata: {},
    lostAt: null,
    ...opts.conversation,
  };
  const card =
    opts.card === undefined
      ? { id: 'card-1', pipelineId: 'pipe-1', stageId: 'stage-proposta', metadata: {} }
      : opts.card;

  const prisma: any = {
    card: {
      findFirst: jest.fn().mockResolvedValue(card),
      update: jest.fn().mockResolvedValue({}),
    },
    pipelineStage: {
      findFirst: jest.fn().mockImplementation((args: any) =>
        Promise.resolve(
          args?.where?.type === 'LOST'
            ? opts.lostStage === undefined
              ? { id: 'stage-lost', type: 'LOST' }
              : opts.lostStage
            : opts.fromStage === undefined
              ? { id: 'stage-proposta' }
              : opts.fromStage,
        ),
      ),
    },
    conversation: { update: jest.fn().mockResolvedValue({}) },
    message: { create: jest.fn().mockResolvedValue({ id: 'msg-1' }) },
  };
  const realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn() } as any;
  const pipelines = { moveCard: jest.fn().mockResolvedValue({}) } as any;
  const conversations = {
    assertConversationAccess: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn().mockResolvedValue(conversation),
    close: jest.fn().mockResolvedValue({ id: 'conv-1', status: 'CLOSED' }),
    reopen: jest.fn().mockResolvedValue({ id: 'conv-1', status: 'OPEN' }),
    broadcastById: jest.fn().mockResolvedValue(undefined),
  } as any;
  const svc = new LostSaleService(prisma, realtime, pipelines, conversations);
  return { svc, prisma, pipelines, conversations };
}

describe('LostSaleService.markLost', () => {
  it('grava o motivo na conversa, move o card para LOST e encerra', async () => {
    const { svc, prisma, pipelines, conversations } = makeService();

    await svc.markLost('o1', 'conv-1', { reason: 'COMPETITOR', note: ' CVC ' }, ACTOR);

    expect(prisma.card.update).toHaveBeenCalledWith({
      where: { id: 'card-1' },
      data: {
        closedReason: 'COMPETITOR',
        metadata: { lostFromStageId: 'stage-proposta' },
      },
    });
    expect(pipelines.moveCard).toHaveBeenCalledWith(
      'card-1',
      'o1',
      { toStageId: 'stage-lost', toIndex: 0 },
      OrgRole.AGENT,
      'u1',
    );
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: expect.objectContaining({
        lostReason: 'COMPETITOR',
        lostNote: 'CVC',
        lostById: 'u1',
        metadata: { lostFromStatus: ConversationStatus.OPEN },
      }),
    });
    expect(prisma.message.create.mock.calls[0][0].data.content.text).toBe(
      '❌ Venda perdida: Comprou com concorrente. CVC',
    );
    expect(conversations.close).toHaveBeenCalledWith('conv-1', 'o1', 'u1', 'ALL', OrgRole.AGENT);
  });

  it('exige texto quando o motivo é "Outro"', async () => {
    const { svc, prisma } = makeService();

    await expect(
      svc.markLost('o1', 'conv-1', { reason: 'OTHER', note: '  ' }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('confere o acesso antes de mexer em qualquer coisa', async () => {
    const { svc, prisma, conversations } = makeService();
    conversations.assertConversationAccess.mockRejectedValue(new Error('not found'));

    await expect(
      svc.markLost('o1', 'conv-1', { reason: 'NO_REPLY' }, ACTOR),
    ).rejects.toThrow('not found');
    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('sem card no funil, registra só na conversa', async () => {
    const { svc, prisma, pipelines, conversations } = makeService({ card: null });

    await svc.markLost('o1', 'conv-1', { reason: 'NO_REPLY' }, ACTOR);

    expect(pipelines.moveCard).not.toHaveBeenCalled();
    expect(prisma.conversation.update).toHaveBeenCalled();
    expect(conversations.close).toHaveBeenCalled();
  });

  it('funil sem etapa LOST não move o card', async () => {
    const { svc, prisma, pipelines } = makeService({ lostStage: null });

    await svc.markLost('o1', 'conv-1', { reason: 'PRICE' }, ACTOR);

    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(pipelines.moveCard).not.toHaveBeenCalled();
  });

  it('conversa já encerrada: não tenta encerrar de novo', async () => {
    const { svc, conversations } = makeService({
      conversation: { status: ConversationStatus.CLOSED },
    });

    await svc.markLost('o1', 'conv-1', { reason: 'JUST_BROWSING' }, ACTOR);

    expect(conversations.close).not.toHaveBeenCalled();
    expect(conversations.broadcastById).toHaveBeenCalledWith('conv-1');
  });

  it('trocar o motivo mantém o status e a etapa de antes da primeira marcação', async () => {
    const { svc, prisma, pipelines } = makeService({
      conversation: {
        status: ConversationStatus.CLOSED,
        lostAt: new Date(),
        metadata: { lostFromStatus: ConversationStatus.OPEN },
      },
      card: {
        id: 'card-1',
        pipelineId: 'pipe-1',
        stageId: 'stage-lost',
        metadata: { lostFromStageId: 'stage-proposta' },
      },
    });

    await svc.markLost('o1', 'conv-1', { reason: 'PRICE' }, ACTOR);

    expect(prisma.card.update.mock.calls[0][0].data.metadata).toEqual({
      lostFromStageId: 'stage-proposta',
    });
    expect(pipelines.moveCard).not.toHaveBeenCalled();
    expect(prisma.conversation.update.mock.calls[0][0].data.metadata).toEqual({
      lostFromStatus: ConversationStatus.OPEN,
    });
  });
});

describe('LostSaleService.undoLost', () => {
  const lostConversation = {
    status: ConversationStatus.CLOSED,
    lostAt: new Date(),
    metadata: { lostFromStatus: ConversationStatus.OPEN, other: 1 },
  };
  const lostCard = {
    id: 'card-1',
    pipelineId: 'pipe-1',
    stageId: 'stage-lost',
    metadata: { lostFromStageId: 'stage-proposta' },
  };

  it('volta o card para a etapa anterior, limpa o motivo e reabre', async () => {
    const { svc, prisma, pipelines, conversations } = makeService({
      conversation: lostConversation,
      card: lostCard,
    });

    await svc.undoLost('o1', 'conv-1', ACTOR);

    expect(prisma.card.update).toHaveBeenCalledWith({
      where: { id: 'card-1' },
      data: { closedReason: null, metadata: {} },
    });
    expect(pipelines.moveCard).toHaveBeenCalledWith(
      'card-1',
      'o1',
      { toStageId: 'stage-proposta', toIndex: 0 },
      OrgRole.AGENT,
      'u1',
    );
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: {
        lostReason: null,
        lostNote: null,
        lostAt: null,
        lostById: null,
        metadata: { other: 1 },
      },
    });
    expect(conversations.reopen).toHaveBeenCalledWith('conv-1', 'o1', 'u1', 'ALL', OrgRole.AGENT);
  });

  it('não reabre conversa que já estava encerrada antes da marcação', async () => {
    const { svc, conversations } = makeService({
      conversation: {
        ...lostConversation,
        metadata: { lostFromStatus: ConversationStatus.CLOSED },
      },
      card: lostCard,
    });

    await svc.undoLost('o1', 'conv-1', ACTOR);

    expect(conversations.reopen).not.toHaveBeenCalled();
    expect(conversations.broadcastById).toHaveBeenCalledWith('conv-1');
  });

  it('recusa quando a conversa não está marcada como perdida', async () => {
    const { svc } = makeService();

    await expect(svc.undoLost('o1', 'conv-1', ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
