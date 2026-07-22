import { OrgRole } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import { PipelinesService } from './pipelines.service';

describe('PipelinesService.assertCardAccess', () => {
  function serviceWith(found: unknown) {
    const prisma: any = {
      card: { findFirst: jest.fn().mockResolvedValue(found) },
    };
    const svc = new PipelinesService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
    ) as any;
    return { svc, prisma };
  }

  it('AGENT com card alheio recebe NotFound', async () => {
    const { svc } = serviceWith(null);
    await expect(
      svc.assertCardAccess('c1', 'o1', OrgRole.AGENT, 'u1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('AGENT com card próprio passa', async () => {
    const { svc } = serviceWith({ id: 'c1' });
    await expect(
      svc.assertCardAccess('c1', 'o1', OrgRole.AGENT, 'u1'),
    ).resolves.toEqual({ id: 'c1' });
  });

  it('AGENT consulta com o OR de escopo', async () => {
    const { svc, prisma } = serviceWith({ id: 'c1' });
    await svc.assertCardAccess('c1', 'o1', OrgRole.AGENT, 'u1');
    expect(prisma.card.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'c1',
        organizationId: 'o1',
        OR: [{ conversation: { assignedToId: 'u1' } }, { assignedToId: 'u1' }],
      },
    });
  });

  it('ADMIN consulta sem cláusula de escopo', async () => {
    const { svc, prisma } = serviceWith({ id: 'c1' });
    await svc.assertCardAccess('c1', 'o1', OrgRole.ADMIN, 'u1');
    expect(prisma.card.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', organizationId: 'o1' },
    });
  });
});
