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
  const service = new PipelinesService(
    prisma,
    realtime,
    cadenceRunner,
    metaCapiQueue,
  );
  // moveCard é testado noutro lugar — aqui espiamos que E6 o chama certo.
  const moveSpy = jest
    .spyOn(service, 'moveCard')
    .mockResolvedValue({ id: 'card-1' } as any);
  return { service, prisma, moveSpy };
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
});
