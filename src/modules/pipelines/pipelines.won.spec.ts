import { BadRequestException } from '@nestjs/common';
import { PipelinesService } from './pipelines.service';

/**
 * E5.1 — Fechamento: ao clicar "Ganho", o atendente informa o nº do pedido; o
 * card guarda esse número (chave de correlação futura com o HUB) e move pra a
 * etapa Ganho (WON). A correlação de verdade com o OfpSalesOrder é a fatia E5.2.
 */
function make(overrides: { card?: unknown; wonStage?: unknown } = {}) {
  const prisma = {
    card: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.card === undefined
          ? { id: 'card-1', pipelineId: 'pipe-1', metadata: { foo: 'bar' } }
          : overrides.card,
      ),
      update: jest.fn().mockResolvedValue({ id: 'card-1' }),
    },
    pipelineStage: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.wonStage === undefined
          ? { id: 'stage-won', type: 'WON' }
          : overrides.wonStage,
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
  const moveSpy = jest
    .spyOn(service, 'moveCard')
    .mockResolvedValue({ id: 'card-1' } as any);
  return { service, prisma, moveSpy };
}

describe('PipelinesService.markWonForConversation (E5.1)', () => {
  it('grava o nº do pedido em metadata (preservando o resto) e move pra etapa WON', async () => {
    const { service, prisma, moveSpy } = make();
    await service.markWonForConversation('org-1', 'conv-1', 'PED-12345');

    const upd = prisma.card.update.mock.calls[0][0];
    expect(upd.where).toEqual({ id: 'card-1' });
    expect(upd.data.metadata).toMatchObject({ foo: 'bar', orderNumber: 'PED-12345' });
    expect(moveSpy).toHaveBeenCalledWith(
      'card-1',
      'org-1',
      expect.objectContaining({ toStageId: 'stage-won' }),
    );
  });

  it('sem nº do pedido: move pra WON mesmo assim, sem gravar metadata', async () => {
    const { service, prisma, moveSpy } = make();
    await service.markWonForConversation('org-1', 'conv-1');

    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(moveSpy).toHaveBeenCalledWith(
      'card-1',
      'org-1',
      expect.objectContaining({ toStageId: 'stage-won' }),
    );
  });

  it('lança se a conversa não tem card no funil', async () => {
    const { service, moveSpy } = make({ card: null });
    await expect(
      service.markWonForConversation('org-1', 'conv-1', 'PED-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(moveSpy).not.toHaveBeenCalled();
  });

  it('lança se o funil não tem etapa Ganho (WON)', async () => {
    const { service, moveSpy } = make({ wonStage: null });
    await expect(
      service.markWonForConversation('org-1', 'conv-1', 'PED-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(moveSpy).not.toHaveBeenCalled();
  });
});
