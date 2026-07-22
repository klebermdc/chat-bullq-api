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

describe('PipelinesService.createCard — escopo por atribuição', () => {
  function serviceWith(opts: {
    pipeline?: unknown;
    conversation?: unknown;
    existingCard?: unknown;
    stage?: unknown;
    maxCard?: unknown;
    createdCard?: unknown;
  }) {
    const prisma: any = {
      pipeline: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            opts.pipeline ?? { id: 'p1', organizationId: 'o1' },
          ),
      },
      conversation: {
        findFirst: jest.fn().mockResolvedValue(opts.conversation ?? null),
        findUnique: jest.fn().mockResolvedValue(
          opts.conversation ?? {
            id: 'conv1',
            organizationId: 'o1',
            contactId: 'ct1',
            contact: { name: 'Fulano', phone: '5511999999999' },
          },
        ),
      },
      card: {
        findFirst: jest.fn().mockResolvedValue(opts.existingCard ?? null),
        findUnique: jest
          .fn()
          .mockResolvedValue(opts.createdCard ?? { id: 'c1' }),
        create: jest
          .fn()
          .mockResolvedValue(opts.createdCard ?? { id: 'c1' }),
      },
      pipelineStage: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.stage ?? { id: 's1', pipelineId: 'p1' }),
        findUnique: jest
          .fn()
          .mockResolvedValue(opts.stage ?? { id: 's1', pipelineId: 'p1' }),
      },
    };
    const realtime: any = { emitToOrg: jest.fn() };
    const svc = new PipelinesService(
      prisma,
      realtime,
      {} as any,
      {} as any,
    ) as any;
    return { svc, prisma };
  }

  it('AGENT criando card p/ conversa que NÃO é dele lança NotFound', async () => {
    const { svc, prisma } = serviceWith({ conversation: null });
    await expect(
      svc.createCard(
        'p1',
        'o1',
        { conversationId: 'conv1' },
        OrgRole.AGENT,
        'u1',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv1', organizationId: 'o1', assignedToId: 'u1' },
      select: { id: true },
    });
  });

  it('AGENT criando card p/ conversa própria prossegue', async () => {
    const { svc, prisma } = serviceWith({
      conversation: { id: 'conv1' },
    });
    // conversation.findUnique (hydration) precisa devolver o formato completo
    prisma.conversation.findUnique.mockResolvedValue({
      id: 'conv1',
      organizationId: 'o1',
      contactId: 'ct1',
      contact: { name: 'Fulano', phone: '5511999999999' },
    });
    await expect(
      svc.createCard(
        'p1',
        'o1',
        { conversationId: 'conv1' },
        OrgRole.AGENT,
        'u1',
      ),
    ).resolves.toEqual({ id: 'c1' });
    expect(prisma.conversation.findFirst).toHaveBeenCalledWith({
      where: { id: 'conv1', organizationId: 'o1', assignedToId: 'u1' },
      select: { id: true },
    });
  });

  it('ADMIN pula o check de posse (findFirst da conversa não é chamado)', async () => {
    const { svc, prisma } = serviceWith({});
    await expect(
      svc.createCard(
        'p1',
        'o1',
        { conversationId: 'conv1' },
        OrgRole.ADMIN,
        'u1',
      ),
    ).resolves.toEqual({ id: 'c1' });
    expect(prisma.conversation.findFirst).not.toHaveBeenCalled();
  });
});
