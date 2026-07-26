import { BadRequestException } from '@nestjs/common';
import { PipelinesService } from './pipelines.service';

/**
 * E6 — Entrega: ao clicar "Pedido enviado", o card da conversa move pra etapa
 * final do funil. Diferente de `ensureConversationAtStageByName`, a entrega
 * acontece DEPOIS do fechamento (card já ganho/WON) — então NÃO pode ter a
 * guarda "só mexe em OPEN". Por decisão de projeto, E6 é só ETAPA (sem tag
 * redundante "ingressos enviados").
 */
function make(overrides: {
  stage?: unknown;
  card?: unknown;
} = {}) {
  const prisma = {
    pipelineStage: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.stage === undefined
          ? { id: 'stage-final', pipelineId: 'pipe-1' }
          : overrides.stage,
      ),
    },
    card: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.card === undefined
          ? { id: 'card-1', pipelineId: 'pipe-1', status: 'WON' }
          : overrides.card,
      ),
    },
  } as any;
  const realtime = { emitToOrg: jest.fn() } as any;
  const cadenceRunner = { maybeStartForStage: jest.fn() } as any;
  const metaCapiQueue = { enqueuePurchase: jest.fn() } as any;
  // Task 10: novas deps injetadas — geração do aceite + envio do link no WhatsApp.
  const acceptances = { createForConversation: jest.fn() } as any;
  const messages = { send: jest.fn() } as any;
  const service = new PipelinesService(
    prisma,
    realtime,
    cadenceRunner,
    metaCapiQueue,
    acceptances,
    messages,
  );
  // moveCard é testado noutro lugar — aqui espiamos que E6 o chama certo.
  const moveSpy = jest
    .spyOn(service, 'moveCard')
    .mockResolvedValue({ id: 'card-1' } as any);
  return { service, prisma, moveSpy, acceptances, messages };
}

describe('PipelinesService.markOrderSentForConversation (E6)', () => {
  it('move o card da conversa pra etapa final — mesmo com card já ganho (WON)', async () => {
    const { service, prisma, moveSpy } = make();
    await service.markOrderSentForConversation('org-1', 'conv-1');

    expect(prisma.pipelineStage.findFirst).toHaveBeenCalled();
    expect(moveSpy).toHaveBeenCalledWith(
      'card-1',
      'org-1',
      expect.objectContaining({ toStageId: 'stage-final' }),
    );
  });

  it('lança se a etapa final não existe no funil', async () => {
    const { service, moveSpy } = make({ stage: null });
    await expect(
      service.markOrderSentForConversation('org-1', 'conv-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(moveSpy).not.toHaveBeenCalled();
  });

  it('lança se a conversa não tem card no funil', async () => {
    const { service, moveSpy } = make({ card: null });
    await expect(
      service.markOrderSentForConversation('org-1', 'conv-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(moveSpy).not.toHaveBeenCalled();
  });

  it('com withAcceptance cria aceite, envia link no WhatsApp e ainda move o card', async () => {
    const { service, moveSpy, acceptances, messages } = make();
    const created = { acceptance: { id: 'acc-1' }, link: 'https://x.test/aceite/tok' };
    acceptances.createForConversation.mockResolvedValue(created);
    messages.send.mockResolvedValue({ id: 'm1' });
    const res = await service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
      withAcceptance: true,
      items: [{ description: 'Ingresso' }],
      createdById: 'user-1',
    });
    expect(moveSpy).toHaveBeenCalled();
    expect(acceptances.createForConversation).toHaveBeenCalledWith(
      'org-1',
      'conv-1',
      expect.objectContaining({
        items: [{ description: 'Ingresso' }],
        createdById: 'user-1',
      }),
    );
    expect(messages.send).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        type: 'TEXT',
        content: expect.objectContaining({
          text: expect.stringContaining('https://x.test/aceite/tok'),
        }),
      }),
      'user-1',
      'org-1',
    );
    expect(res.acceptanceLink).toBe('https://x.test/aceite/tok');
  });

  it('withAcceptance=false mantém o legado: só move o card, sem aceite', async () => {
    const { service, acceptances } = make();
    const res = await service.markOrderSentForConversation('org-1', 'conv-1', undefined, {
      withAcceptance: false,
    });
    expect(acceptances.createForConversation).not.toHaveBeenCalled();
    expect(res.acceptanceLink).toBeUndefined();
  });
});
