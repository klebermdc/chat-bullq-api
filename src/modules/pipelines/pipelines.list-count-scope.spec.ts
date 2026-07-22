import { OrgRole } from '@prisma/client';
import { PipelinesService } from './pipelines.service';

/**
 * O card do funil mostra a contagem de cards (`_count`) — sem escopo, o
 * AGENT via o total da ORG inteira ali, enquanto o board (getBoard) só
 * mostra os cards dele. Card dizia "42", board tinha 6.
 */
describe('PipelinesService.listPipelines — escopo da contagem de cards', () => {
  function serviceWith() {
    const prisma: any = {
      pipeline: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new PipelinesService(prisma, {} as any, {} as any, {} as any) as any;
    return { svc, prisma };
  }

  it('AGENT: a contagem de cards carrega o where de escopo', async () => {
    const { svc, prisma } = serviceWith();
    await svc.listPipelines('o1', OrgRole.AGENT, 'u1');
    expect(prisma.pipeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          _count: {
            select: {
              cards: {
                where: {
                  OR: [
                    { conversation: { assignedToId: 'u1' } },
                    { assignedToId: 'u1' },
                  ],
                },
              },
            },
          },
        }),
      }),
    );
  });

  it('ADMIN: a contagem de cards NÃO carrega where nenhum (total real da org)', async () => {
    const { svc, prisma } = serviceWith();
    await svc.listPipelines('o1', OrgRole.ADMIN, 'u1');
    expect(prisma.pipeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          _count: { select: { cards: { where: {} } } },
        }),
      }),
    );
  });

  it('sem currentUserId (chamador de sistema): sem escopo', async () => {
    const { svc, prisma } = serviceWith();
    await svc.listPipelines('o1');
    expect(prisma.pipeline.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          _count: { select: { cards: { where: {} } } },
        }),
      }),
    );
  });
});
