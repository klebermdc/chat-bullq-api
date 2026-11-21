import { CardStatus } from '@prisma/client';
import { PipelinesService } from './pipelines.service';

/**
 * moveCard → WON enfileira o Purchase da Meta CAPI. Quem já mandou a compra
 * por outro caminho (o OFP Hub manda a dele ao salvar o pedido) passa
 * `skipCapi` pra Meta não contar em dobro.
 */
function make() {
  const card = {
    id: 'card-1',
    organizationId: 'org-1',
    pipelineId: 'pipe-1',
    stageId: 'stage-open',
    order: 0,
    status: CardStatus.OPEN,
    closedAt: null,
    conversationId: null,
  };
  const tx = {
    card: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const prisma = {
    card: {
      findFirst: jest.fn().mockResolvedValue(card),
      findUnique: jest.fn().mockResolvedValue({ id: 'card-1' }),
    },
    pipelineStage: {
      findUnique: jest.fn().mockResolvedValue({ id: 'stage-won', pipelineId: 'pipe-1', type: 'WON' }),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as any;
  const realtime = { emitToOrg: jest.fn() } as any;
  const cadenceRunner = { maybeStartForStage: jest.fn().mockResolvedValue(undefined) } as any;
  const metaCapiQueue = { enqueuePurchase: jest.fn().mockResolvedValue(undefined) } as any;
  const service = new PipelinesService(prisma, realtime, cadenceRunner, metaCapiQueue, {} as any, {} as any);
  return { service, metaCapiQueue };
}

const toWon = { toStageId: 'stage-won', toIndex: 0 } as any;

describe('PipelinesService.moveCard — Purchase da Meta CAPI', () => {
  it('enfileira o Purchase ao fechar em WON (padrão)', async () => {
    const { service, metaCapiQueue } = make();
    await service.moveCard('card-1', 'org-1', toWon);
    expect(metaCapiQueue.enqueuePurchase).toHaveBeenCalledWith({ cardId: 'card-1', organizationId: 'org-1' });
  });

  it('skipCapi: fecha em WON sem enfileirar o Purchase', async () => {
    const { service, metaCapiQueue } = make();
    await service.moveCard('card-1', 'org-1', toWon, undefined, undefined, { skipCapi: true });
    expect(metaCapiQueue.enqueuePurchase).not.toHaveBeenCalled();
  });
});
