import {
  MAX_PLACEHOLDER_LENGTH,
  MAX_VALUE_KEYS,
  MAX_VALUE_LENGTH,
  canonicalKey,
  extractPlaceholders,
  fillTemplate,
  normalizeValues,
} from './placeholders.util';

describe('extractPlaceholders', () => {
  it('devolve os campos únicos, com colchetes, na ordem em que aparecem', () => {
    const body = 'Eu, [Nome do Cliente], CPF [CPF do Cliente], contrato com [Razão Social da Agência]. Assina: [Nome do Cliente].';
    expect(extractPlaceholders(body)).toEqual([
      '[Nome do Cliente]',
      '[CPF do Cliente]',
      '[Razão Social da Agência]',
    ]);
  });

  it('devolve vazio quando não há campos', () => {
    expect(extractPlaceholders('Texto corrido sem campo.')).toEqual([]);
    expect(extractPlaceholders('')).toEqual([]);
  });

  it('ignora caixinha "[ ]", colchete vazio e colchetes aninhados ou quebrados', () => {
    expect(extractPlaceholders('[ ] Sim  [] Não [   ] c [x [y] z')).toEqual(['[y]']);
  });

  it('trata "[ENTRE COLCHETES]" como campo (o admin edita o texto)', () => {
    expect(extractPlaceholders('[ENTRE COLCHETES]')).toEqual(['[ENTRE COLCHETES]']);
  });

  it('texto entre colchetes acima do teto não é campo (e fica intacto no preenchimento)', () => {
    const exact = 'a'.repeat(MAX_PLACEHOLDER_LENGTH);
    const long = 'b'.repeat(MAX_PLACEHOLDER_LENGTH + 1);
    expect(extractPlaceholders(`[${exact}] [${long}]`)).toEqual([`[${exact}]`]);
    expect(fillTemplate(`[${long}]`, {})).toEqual({ text: `[${long}]`, missing: [] });
  });

  it('não atravessa quebra de linha', () => {
    expect(extractPlaceholders('[Linha\nquebrada] e [Dia]')).toEqual(['[Dia]']);
  });

  it('apara espaços internos para formar o nome', () => {
    expect(extractPlaceholders('[ Dia ] e [Dia]')).toEqual(['[Dia]']);
  });
});

describe('canonicalKey', () => {
  it('aceita com ou sem colchetes e apara', () => {
    expect(canonicalKey('[ Nome ]')).toBe('[Nome]');
    expect(canonicalKey(' Nome ')).toBe('[Nome]');
    expect(canonicalKey('[Nome]')).toBe('[Nome]');
  });
});

describe('normalizeValues', () => {
  it('canoniza a chave, apara, descarta não-string e corta no tamanho máximo', () => {
    const out = normalizeValues({ '[a]': '  x  ', b: 3 as unknown as string, c: 'y'.repeat(MAX_VALUE_LENGTH + 10) });
    expect(out).toEqual({ '[a]': 'x', '[c]': 'y'.repeat(MAX_VALUE_LENGTH) });
  });

  it('limita o número de chaves', () => {
    const many = Object.fromEntries(Array.from({ length: MAX_VALUE_KEYS + 5 }, (_, i) => [`[k${i}]`, 'v']));
    expect(Object.keys(normalizeValues(many))).toHaveLength(MAX_VALUE_KEYS);
  });

  it('aceita undefined/null e devolve objeto vazio', () => {
    expect(normalizeValues(undefined)).toEqual({});
    expect(normalizeValues(null)).toEqual({});
  });

  it('não muta a entrada', () => {
    const input = { '[a]': '  x ' };
    normalizeValues(input);
    expect(input).toEqual({ '[a]': '  x ' });
  });
});

describe('fillTemplate', () => {
  it('troca todas as ocorrências (chaves com colchetes) e não lista faltantes quando tudo veio', () => {
    const { text, missing } = fillTemplate('[Nome] e de novo [Nome], em [Cidade].', {
      '[Nome]': 'Ana',
      '[Cidade]': 'Orlando',
    });
    expect(text).toBe('Ana e de novo Ana, em Orlando.');
    expect(missing).toEqual([]);
  });

  it('aceita também chave sem colchetes', () => {
    expect(fillTemplate('[Nome]', { Nome: 'Ana' }).text).toBe('Ana');
  });

  it('deixa no texto e lista (com colchetes) o campo sem valor ou só com espaço', () => {
    const { text, missing } = fillTemplate('[Nome], [CPF] e [Cidade]', { '[Nome]': 'Ana', '[CPF]': '   ' });
    expect(text).toBe('Ana, [CPF] e [Cidade]');
    expect(missing).toEqual(['[CPF]', '[Cidade]']);
  });

  it('caixinha "[ ]" fica intacta e não conta como faltante', () => {
    expect(fillTemplate('[ ] Sim [Nome]', { '[Nome]': 'Ana' })).toEqual({ text: '[ ] Sim Ana', missing: [] });
  });

  it('casa o campo mesmo com espaço dentro do colchete', () => {
    expect(fillTemplate('[ Dia ]/[Mês]', { '[Dia]': '5', '[Mês]': 'março' }).text).toBe('5/março');
  });

  it('não interpreta padrões especiais do replace ($&, $1) no valor', () => {
    expect(fillTemplate('[Nome]', { '[Nome]': 'R$& $1 $$' }).text).toBe('R$& $1 $$');
  });

  it('não substitui de novo um campo que veio dentro de um valor', () => {
    const { text, missing } = fillTemplate('[A] [B]', { '[A]': '[B]', '[B]': 'b' });
    expect(text).toBe('[B] b');
    expect(missing).toEqual([]);
  });

  it('campo com nome de propriedade do protótipo não acha valor herdado', () => {
    const { text, missing } = fillTemplate('[constructor] [toString] [__proto__]', {});
    expect(text).toBe('[constructor] [toString] [__proto__]');
    expect(missing).toEqual(['[constructor]', '[toString]', '[__proto__]']);
  });

  it('ignora chaves que o modelo não tem', () => {
    expect(fillTemplate('[A]', { '[A]': 'a', '[Z]': 'z' })).toEqual({ text: 'a', missing: [] });
  });

  it('apara e corta o valor antes de preencher', () => {
    const { text } = fillTemplate('[A]', { '[A]': `  ${'x'.repeat(MAX_VALUE_LENGTH + 1)}  ` });
    expect(text).toHaveLength(MAX_VALUE_LENGTH);
  });
});
