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

  describe('tagAdLeadIfReferral', () => {
    const base = { organizationId: 'org1', conversationId: 'cv1' };

    it('marca a conversa quando a mensagem traz ctwaClid', async () => {
      const { service, prisma } = make();
      const out = await service.tagAdLeadIfReferral({
        ...base,
        ctwaClid: 'ARAbc123',
      });

      expect(out).toBe(true);
      expect(prisma.tag.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { organizationId: 'org1', name: 'Anúncio Meta' },
        }),
      );
      expect(prisma.conversationTag.create).toHaveBeenCalled();
    });

    it('NÃO marca quando a mensagem não traz referral (lead orgânico)', async () => {
      const { service, prisma } = make();

      expect(await service.tagAdLeadIfReferral({ ...base, ctwaClid: null })).toBe(false);
      expect(await service.tagAdLeadIfReferral({ ...base })).toBe(false);
      expect(prisma.conversationTag.create).not.toHaveBeenCalled();
    });

    it('é idempotente: re-aplicar a tag não estoura', async () => {
      const { service, prisma } = make();
      prisma.conversationTag.create.mockRejectedValueOnce({ code: 'P2002' });

      await expect(
        service.tagAdLeadIfReferral({ ...base, ctwaClid: 'ARAbc123' }),
      ).resolves.toBe(true);
    });
  });

  describe('matchesAdMarker (frase automática de anúncio)', () => {
    it('casa a frase EXATA do anúncio, ignorando caixa/acento', () => {
      const { service } = make();
      expect(service.matchesAdMarker('Quero fazer uma cotação')).toBe(true);
      expect(service.matchesAdMarker('quero fazer uma cotacao')).toBe(true);
      expect(
        service.matchesAdMarker('Olá! Posso ter mais informações sobre isso?'),
      ).toBe(true);
    });

    it('NÃO casa quando a frase é só parte de um texto maior (evita falso positivo)', () => {
      const { service } = make();
      expect(
        service.matchesAdMarker('bom dia, quero fazer uma cotação de ingressos pra 4'),
      ).toBe(false);
      expect(service.matchesAdMarker('olá, tudo bem?')).toBe(false);
      expect(service.matchesAdMarker(null)).toBe(false);
    });
  });

  describe('tagAdLeadIfMarkerPhrase', () => {
    const base = { organizationId: 'org1', conversationId: 'cv1' };

    it('aplica "Anúncio Meta" quando a mensagem é a frase do anúncio', async () => {
      const { service, prisma } = make();
      const out = await service.tagAdLeadIfMarkerPhrase({
        ...base,
        body: 'Quero fazer uma cotação',
      });
      expect(out).toBe(true);
      expect(prisma.tag.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { organizationId: 'org1', name: 'Anúncio Meta' },
        }),
      );
    });

    it('NÃO marca mensagem comum', async () => {
      const { service, prisma } = make();
      expect(
        await service.tagAdLeadIfMarkerPhrase({ ...base, body: 'oi, quero ingressos' }),
      ).toBe(false);
      expect(prisma.conversationTag.create).not.toHaveBeenCalled();
    });

    it('respeita CTWA_AD_MARKERS do ambiente', async () => {
      const anterior = process.env.CTWA_AD_MARKERS;
      process.env.CTWA_AD_MARKERS = 'fale com a gente|promo de verão';
      try {
        const { service } = make();
        expect(service.matchesAdMarker('Fale com a gente')).toBe(true);
        expect(service.matchesAdMarker('Quero fazer uma cotação')).toBe(false);
      } finally {
        if (anterior === undefined) delete process.env.CTWA_AD_MARKERS;
        else process.env.CTWA_AD_MARKERS = anterior;
      }
    });
  });
});
