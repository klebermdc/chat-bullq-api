import { MysteryShopperCriteriaService } from './mystery-shopper-criteria.service';
import { DEFAULT_MYSTERY_CRITERIA } from './default-criteria';

function setup(existing: number) {
  const prisma = {
    aiSkill: {
      count: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([
        { name: 'ocultoTom', description: 'Tom', promptInstructions: 'Educado.' },
        { name: 'vazio', description: 'x', promptInstructions: '  ' },
      ]),
      findFirst: jest.fn().mockResolvedValue({ promptInstructions: 'Ingresso de 2 dias não existe.' }),
    },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  return { service: new MysteryShopperCriteriaService(prisma as never), prisma };
}

describe('MysteryShopperCriteriaService', () => {
  test('cria os critérios padrão só na primeira vez', async () => {
    const first = setup(0);
    await first.service.loadCriteria('org');
    expect(first.prisma.aiSkill.create).toHaveBeenCalledTimes(DEFAULT_MYSTERY_CRITERIA.length);

    const later = setup(3);
    await later.service.loadCriteria('org');
    expect(later.prisma.aiSkill.create).not.toHaveBeenCalled();
  });

  test('ignora skill sem instruções', async () => {
    const { service } = setup(3);
    expect(await service.loadCriteria('org')).toEqual([
      { name: 'ocultoTom', description: 'Tom', instructions: 'Educado.' },
    ]);
  });

  test('regras de produto vêm da skill do Diário', async () => {
    const { service, prisma } = setup(3);
    expect(await service.loadProductRules('org')).toBe('Ingresso de 2 dias não existe.');
    expect(prisma.aiSkill.findFirst.mock.calls[0][0].where).toMatchObject({
      category: 'diario-atendente',
      name: 'diarioRegrasProduto',
    });
  });
});
