import { isDefaultKey, mergeFieldDefaults, readFieldDefaults, suggestAgencyFields } from './field-defaults.util';

describe('isDefaultKey', () => {
  it('aceita [Campo] com 1–150 caracteres', () => {
    expect(isDefaultKey('[Cidade]')).toBe(true);
    expect(isDefaultKey(`[${'a'.repeat(150)}]`)).toBe(true);
  });

  it.each(['Cidade', '[]', '[ ]', `[${'a'.repeat(151)}]`, '[a]b]', '[a\nb]'])('recusa %p', (key) => {
    expect(isDefaultKey(key)).toBe(false);
  });
});

describe('readFieldDefaults', () => {
  it('só mantém chave válida com texto', () => {
    expect(readFieldDefaults({ '[Cidade]': 'SP', '[UF]': '', bad: 'x', '[N]': 3 })).toEqual({ '[Cidade]': 'SP' });
  });

  it.each([null, undefined, 'x', [1], 3])('lixo %p vira {}', (raw) => {
    expect(readFieldDefaults(raw)).toEqual({});
  });
});

describe('mergeFieldDefaults', () => {
  it('substitui, remove com vazio e mantém o ausente — sem mudar o original', () => {
    const current = Object.freeze({ '[Cidade]': 'SP', '[UF]': 'SP', '[Prazo de Cancelamento]': '30 dias' });
    const out = mergeFieldDefaults(current, { '[Cidade]': ' Santos ', '[UF]': '  ', '[Percentual da RAV]': '10%' });
    expect(out).toEqual({ '[Cidade]': 'Santos', '[Prazo de Cancelamento]': '30 dias', '[Percentual da RAV]': '10%' });
    expect(current).toEqual({ '[Cidade]': 'SP', '[UF]': 'SP', '[Prazo de Cancelamento]': '30 dias' });
  });
});

describe('suggestAgencyFields', () => {
  const placeholders = [
    '[UF]', '[Cidade]', '[CNPJ da Agência]', '[Razão Social da Agência]', '[Endereço da Agência]',
    '[Nome do Cliente]', '[Valor Total]', '[Cidade]', '[Percentual da Multa]',
  ];

  it('só campos de agência, distintos e em ordem alfabética', () => {
    expect(suggestAgencyFields(placeholders, null)).toEqual([
      '[Cidade]', '[CNPJ da Agência]', '[Endereço da Agência]', '[Percentual da Multa]',
      '[Razão Social da Agência]', '[UF]',
    ]);
  });

  it('tira razão social/CNPJ/endereço quando a coluna própria já tem valor', () => {
    expect(
      suggestAgencyFields(placeholders, { companyName: 'OFP', companyDocument: ' ', companyAddress: 'Rua A' }),
    ).toEqual(['[Cidade]', '[CNPJ da Agência]', '[Percentual da Multa]', '[UF]']);
  });
});
