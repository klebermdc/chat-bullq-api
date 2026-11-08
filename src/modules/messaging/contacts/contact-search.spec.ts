import {
  findContactIdsBySearch,
  parseContactSearch,
  phoneVariants,
  stripAccents,
} from './contact-search';

describe('stripAccents', () => {
  it('tira acento e cedilha e põe em minúsculas', () => {
    expect(stripAccents('JOÃO Conceição Ângela')).toBe('joao conceicao angela');
  });
});

describe('phoneVariants', () => {
  it('menos de 3 dígitos não vira busca por telefone', () => {
    expect(phoneVariants('12')).toEqual([]);
  });

  it('pedaço curto do número busca como veio', () => {
    expect(phoneVariants('5967')).toEqual(['5967']);
  });

  it('celular com 9 também procura sem o 9 (cadastro antigo)', () => {
    expect(phoneVariants('11982015967')).toEqual(['11982015967', '1182015967']);
  });

  it('celular sem o 9 também procura com o 9', () => {
    expect(phoneVariants('1182015967')).toEqual(['1182015967', '11982015967']);
  });

  it('com 55 na frente procura com e sem o 55', () => {
    expect(phoneVariants('5511982015967')).toEqual([
      '5511982015967',
      '11982015967',
      '1182015967',
    ]);
  });
});

describe('parseContactSearch', () => {
  it('termo vazio não busca nada', () => {
    expect(parseContactSearch('   ')).toBeNull();
  });

  it('separa o nome em palavras sem acento', () => {
    expect(parseContactSearch('  João   da Silva ')?.nameTokens).toEqual([
      'joao',
      'da',
      'silva',
    ]);
  });

  it('telefone com máscara vira só dígitos, com variantes', () => {
    const parsed = parseContactSearch('(11) 98201-5967');

    expect(parsed?.phones).toEqual(['11982015967', '1182015967']);
  });

  it('escapa curingas do LIKE digitados pelo usuário', () => {
    expect(parseContactSearch('50%_off')?.nameTokens).toEqual(['50\\%\\_off']);
  });

  it('limita a 6 palavras', () => {
    expect(parseContactSearch('a b c d e f g h')?.nameTokens).toHaveLength(6);
  });
});

describe('findContactIdsBySearch', () => {
  const sqlOf = (call: any) => call[0].sql as string;

  it('não consulta o banco quando o termo é vazio', async () => {
    const prisma = { $queryRaw: jest.fn() };

    const out = await findContactIdsBySearch(prisma as any, 'org-1', ' ', { take: 10 });

    expect(out).toEqual({ ids: [], total: 0 });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('devolve ids e o total da consulta', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([
        { id: 'c1', total: BigInt(2) },
        { id: 'c2', total: BigInt(2) },
      ]),
    };

    const out = await findContactIdsBySearch(prisma as any, 'org-1', 'maria', { take: 10 });

    expect(out).toEqual({ ids: ['c1', 'c2'], total: 2 });
    const sql = sqlOf(prisma.$queryRaw.mock.calls[0]);
    expect(sql).toContain('translate(lower(');
    expect(sql).toContain('deleted_at IS NULL');
  });
});
