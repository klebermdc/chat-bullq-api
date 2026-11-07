import { buildAdvancedBlocks } from './inbox-advanced-where';

describe('buildAdvancedBlocks (filtros avançados da inbox)', () => {
  it('sem filtro nenhum não restringe nada', () => {
    expect(buildAdvancedBlocks({})).toEqual([]);
  });

  describe('etiquetas', () => {
    it('modo "qualquer" casa a etiqueta na conversa OU no contato', () => {
      const [block] = buildAdvancedBlocks({ tagIds: ['a', 'b'] });

      expect(block).toEqual({
        OR: [
          { tags: { some: { tagId: { in: ['a', 'b'] } } } },
          { contact: { tags: { some: { tagId: { in: ['a', 'b'] } } } } },
        ],
      });
    });

    it('modo "todas" exige cada etiqueta, uma restrição por etiqueta', () => {
      const blocks = buildAdvancedBlocks({ tagIds: ['a', 'b'], tagMatch: 'all' });

      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toEqual({
        OR: [
          { tags: { some: { tagId: 'a' } } },
          { contact: { tags: { some: { tagId: 'a' } } } },
        ],
      });
      expect(blocks[1].OR?.[0]).toEqual({ tags: { some: { tagId: 'b' } } });
    });

    it('etiqueta excluída some da conversa e do contato', () => {
      const [block] = buildAdvancedBlocks({ excludeTagIds: ['x'] });

      expect(block).toEqual({
        tags: { none: { tagId: { in: ['x'] } } },
        contact: { tags: { none: { tagId: { in: ['x'] } } } },
      });
    });
  });

  describe('atendente', () => {
    it('vários atendentes viram uma lista', () => {
      const [block] = buildAdvancedBlocks({ assignedToIds: ['u1', 'u2'] });

      expect(block).toEqual({ OR: [{ assignedToId: { in: ['u1', 'u2'] } }] });
    });

    it('atendentes + "sem atendente" juntos casam qualquer um dos dois', () => {
      const [block] = buildAdvancedBlocks({
        assignedToIds: ['u1'],
        assignedToNone: true,
      });

      expect(block).toEqual({
        OR: [{ assignedToId: { in: ['u1'] } }, { assignedToId: null }],
      });
    });

    it('"sem atendente" sozinho fica a cargo do filtro antigo', () => {
      expect(buildAdvancedBlocks({ assignedToNone: true })).toEqual([]);
    });
  });

  it('etapa do funil casa card aberto ligado à conversa ou ao contato', () => {
    const [block] = buildAdvancedBlocks({ stageIds: ['s1'] });

    const card = { some: { stageId: { in: ['s1'] }, status: 'OPEN' } };
    expect(block).toEqual({ OR: [{ cards: card }, { contact: { cards: card } }] });
  });

  describe('venda perdida', () => {
    it('"só perdidas" pede lostAt preenchido', () => {
      expect(buildAdvancedBlocks({ lost: 'only' })).toEqual([
        { lostAt: { not: null } },
      ]);
    });

    it('"só perdidas" com motivo filtra pelo código do motivo', () => {
      expect(buildAdvancedBlocks({ lost: 'only', lostReasons: ['PRICE'] })).toEqual([
        { lostAt: { not: null }, lostReason: { in: ['PRICE'] } },
      ]);
    });

    it('"esconder perdidas" pede lostAt vazio e ignora motivo', () => {
      expect(
        buildAdvancedBlocks({ lost: 'exclude', lostReasons: ['PRICE'] }),
      ).toEqual([{ lostAt: null }]);
    });
  });

  describe('origem', () => {
    it('anúncio = contato com marca de clique em anúncio', () => {
      expect(buildAdvancedBlocks({ origin: 'ad' })).toEqual([
        {
          contact: {
            OR: [{ ctwaClid: { not: null } }, { ctwaSourceId: { not: null } }],
          },
        },
      ]);
    });

    it('sem anúncio = nenhuma das duas marcas', () => {
      expect(buildAdvancedBlocks({ origin: 'organic' })).toEqual([
        { contact: { ctwaClid: null, ctwaSourceId: null } },
      ]);
    });
  });

  it('parado desde = última mensagem antes do corte', () => {
    const cut = new Date('2026-11-07T10:00:00Z');

    expect(buildAdvancedBlocks({ idleBefore: cut })).toEqual([
      { lastMessageAt: { lte: cut } },
    ]);
  });

  it('cada filtro é um bloco independente (AND entre eles)', () => {
    const blocks = buildAdvancedBlocks({
      tagIds: ['a'],
      excludeTagIds: ['x'],
      stageIds: ['s1'],
      lost: 'exclude',
      origin: 'ad',
    });

    expect(blocks).toHaveLength(5);
  });
});
