import { BadRequestException } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';

function make(over: {
  correlatedCards?: any[];
  candidateCards?: any[];
  orders?: any[];
  order?: any;
  card?: any;
  wonStage?: any;
} = {}) {
  const findMany = jest
    .fn()
    // 1ª chamada: cards correlacionados (pra montar o set de externalIds já ligados)
    .mockResolvedValueOnce(over.correlatedCards ?? [])
    // 2ª chamada: cards candidatos (com contato)
    .mockResolvedValueOnce(over.candidateCards ?? []);
  const prisma = {
    card: {
      findMany,
      findUnique: jest.fn().mockResolvedValue(
        over.card === undefined
          ? { id: 'card-1', organizationId: 'org-1', pipelineId: 'pipe-1', stageId: 'stage-old', metadata: {} }
          : over.card,
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    ofpSalesOrder: {
      findMany: jest.fn().mockResolvedValue(over.orders ?? []),
      findUnique: jest.fn().mockResolvedValue(
        over.order === undefined
          ? { externalId: 'ext-9', pedido: 'PED-9', venda: 4200 }
          : over.order,
      ),
    },
    pipelineStage: {
      findFirst: jest.fn().mockResolvedValue(
        over.wonStage === undefined ? { id: 'stage-won', type: 'WON' } : over.wonStage,
      ),
    },
  } as any;
  const pipelines = { moveCard: jest.fn().mockResolvedValue({}) } as any;
  return { service: new ReconciliationService(prisma, pipelines), prisma, pipelines };
}

describe('ReconciliationService', () => {
  describe('listOrphans', () => {
    it('retorna pedidos não-correlacionados com candidatos ordenados por score', async () => {
      const { service } = make({
        correlatedCards: [{ metadata: { ofpOrderExternalId: 'ext-corr' } }],
        candidateCards: [
          {
            id: 'card-1',
            conversationId: 'conv-1',
            value: 4200,
            contact: { name: 'João Câmara', phone: '11982015967', email: null },
          },
        ],
        orders: [
          { externalId: 'ext-corr', pedido: 'PED-1', cliente: 'X', data: new Date() },
          {
            externalId: 'ext-new',
            pedido: 'PED-9',
            cliente: 'João Câmara',
            telefoneCliente: '+55 11 98201-5967',
            venda: 4200,
            data: new Date(),
          },
        ],
      });

      const res = await service.listOrphans();
      // ext-corr é descartado (já correlacionado); sobra ext-new
      expect(res).toHaveLength(1);
      expect(res[0].order.externalId).toBe('ext-new');
      expect(res[0].suggestions[0]).toMatchObject({ cardId: 'card-1' });
      expect(res[0].suggestions[0].reasons).toEqual(
        expect.arrayContaining(['telefone', 'nome', 'valor']),
      );
    });
  });

  describe('link', () => {
    it('vincula: grava correlação (+nº pedido +valor) e move o card pra WON', async () => {
      const { service, prisma, pipelines } = make();
      await service.link('ext-9', 'card-1', 'org-1');

      const upd = prisma.card.update.mock.calls[0][0];
      expect(upd.data.metadata).toMatchObject({
        orderNumber: 'PED-9',
        ofpOrderExternalId: 'ext-9',
      });
      expect(upd.data.value).toBe(4200);
      expect(pipelines.moveCard).toHaveBeenCalledWith(
        'card-1',
        'org-1',
        expect.objectContaining({ toStageId: 'stage-won' }),
      );
    });

    it('lança se o pedido não existe', async () => {
      const { service, pipelines } = make({ order: null });
      await expect(service.link('nope', 'card-1', 'org-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(pipelines.moveCard).not.toHaveBeenCalled();
    });

    it('lança se o card é de outra org', async () => {
      const { service } = make({
        card: { id: 'card-1', organizationId: 'org-OUTRA', pipelineId: 'p', stageId: 's', metadata: {} },
      });
      await expect(service.link('ext-9', 'card-1', 'org-1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });
});
