import { NotFoundException } from '@nestjs/common';
import { LeadOriginService } from './lead-origin.service';

function make() {
  const prisma = {
    conversation: { findFirst: jest.fn().mockResolvedValue({ id: 'conv-1' }) },
    tag: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockResolvedValue({ id: 'tag-ig' }),
    },
    conversationTag: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
    },
  } as any;
  return { service: new LeadOriginService(prisma), prisma };
}

describe('LeadOriginService.setOrigin', () => {
  it('INSTAGRAM_ORGANIC: upsert da tag + link na conversa', async () => {
    const { service, prisma } = make();
    await service.setOrigin('org-1', 'conv-1', 'INSTAGRAM_ORGANIC');
    expect(prisma.tag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_name: { organizationId: 'org-1', name: 'Instagram Orgânico' } },
      }),
    );
    expect(prisma.conversationTag.create).toHaveBeenCalledWith({
      data: { conversationId: 'conv-1', tagId: 'tag-ig' },
    });
  });

  it('WHATSAPP_DIRECT: remove tags de origem e NÃO cria link', async () => {
    const { service, prisma } = make();
    prisma.tag.findMany.mockResolvedValue([{ id: 'tag-ig', name: 'Instagram Orgânico' }]);
    await service.setOrigin('org-1', 'conv-1', 'WHATSAPP_DIRECT');
    expect(prisma.conversationTag.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', tagId: { in: ['tag-ig'] } },
    });
    expect(prisma.conversationTag.create).not.toHaveBeenCalled();
    expect(prisma.tag.upsert).not.toHaveBeenCalled();
  });

  it('trocar origem: limpa a anterior antes de aplicar a nova (idempotente)', async () => {
    const { service, prisma } = make();
    prisma.tag.findMany.mockResolvedValue([{ id: 'tag-ig', name: 'Instagram Orgânico' }]);
    await service.setOrigin('org-1', 'conv-1', 'INSTAGRAM_ORGANIC');
    expect(prisma.conversationTag.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1', tagId: { in: ['tag-ig'] } },
    });
    expect(prisma.conversationTag.create).toHaveBeenCalled();
  });

  it('conversa de outra org: 404', async () => {
    const { service, prisma } = make();
    prisma.conversation.findFirst.mockResolvedValue(null);
    await expect(service.setOrigin('org-x', 'conv-1', 'INSTAGRAM_ORGANIC')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
