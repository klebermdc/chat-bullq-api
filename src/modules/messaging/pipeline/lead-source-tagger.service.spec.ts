import { LeadSourceTaggerService } from './lead-source-tagger.service';

function make() {
  const prisma = {
    tag: {
      upsert: jest.fn().mockResolvedValue({ id: 'tag-ig' }),
    },
    conversationTag: {
      create: jest.fn().mockResolvedValue({}),
    },
  } as any;
  return { service: new LeadSourceTaggerService(prisma), prisma };
}

describe('LeadSourceTaggerService', () => {
  describe('matches (marca do Instagram orgânico)', () => {
    it('casa a frase-marca ignorando caixa/acento/pontuação ao redor', () => {
      const { service } = make();
      expect(service.matches('Oi! Vim pelo Instagram e quero saber sobre Orlando 🌴')).toBe(true);
      expect(service.matches('vim pelo instagram')).toBe(true);
      expect(service.matches('VIM PELO INSTAGRAM')).toBe(true);
    });
    it('não casa mensagem comum', () => {
      const { service } = make();
      expect(service.matches('Olá, quero um orçamento pra Disney')).toBe(false);
      expect(service.matches(null)).toBe(false);
      expect(service.matches('')).toBe(false);
    });
  });

  describe('tagInstagramOrganicIfMatch', () => {
    const params = {
      organizationId: 'org-1',
      conversationId: 'conv-1',
      body: 'Oi! Vim pelo Instagram 🌴',
    };

    it('aplica a tag "Instagram Orgânico" quando a marca bate', async () => {
      const { service, prisma } = make();
      const applied = await service.tagInstagramOrganicIfMatch(params);

      expect(applied).toBe(true);
      expect(prisma.tag.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId_name: { organizationId: 'org-1', name: 'Instagram Orgânico' } },
        }),
      );
      expect(prisma.conversationTag.create).toHaveBeenCalledWith({
        data: { conversationId: 'conv-1', tagId: 'tag-ig' },
      });
    });

    it('NÃO faz nada quando a marca não bate', async () => {
      const { service, prisma } = make();
      const applied = await service.tagInstagramOrganicIfMatch({
        ...params,
        body: 'oi, quero orçamento',
      });

      expect(applied).toBe(false);
      expect(prisma.tag.upsert).not.toHaveBeenCalled();
      expect(prisma.conversationTag.create).not.toHaveBeenCalled();
    });

    it('idempotente: se a tag já estava na conversa (P2002), não lança e retorna true', async () => {
      const { service, prisma } = make();
      prisma.conversationTag.create.mockRejectedValueOnce(
        Object.assign(new Error('dup'), { code: 'P2002' }),
      );
      await expect(service.tagInstagramOrganicIfMatch(params)).resolves.toBe(true);
    });
  });
});
