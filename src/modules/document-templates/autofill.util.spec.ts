import { buildAutofill, resolveAutofill, saoPauloDateParts } from './autofill.util';

const ALL = [
  '[Razão Social da Agência]', '[CNPJ da Agência]', '[Endereço da Agência]', '[Representante Legal da Agência]',
  '[Nome do Cliente]', '[CPF do Cliente]', '[Telefone do Cliente]', '[E-mail do Cliente]', '[Endereço do Cliente]',
  '[Cidade]', '[Dia]', '[Mês]', '[Ano]', '[Valor Total]',
];

describe('saoPauloDateParts', () => {
  it('usa o fuso de Brasília (00:30 UTC ainda é o dia anterior em SP)', () => {
    expect(saoPauloDateParts(new Date('2026-03-01T00:30:00Z'))).toEqual({ day: '28', month: 'fevereiro', year: '2026' });
  });

  it('mês por extenso em minúsculas', () => {
    expect(saoPauloDateParts(new Date('2026-11-15T15:00:00Z'))).toEqual({ day: '15', month: 'novembro', year: '2026' });
  });
});

describe('buildAutofill', () => {
  const now = new Date('2026-11-15T15:00:00Z');

  it('preenche agência, cliente e data só para os campos que o modelo tem', () => {
    const values = buildAutofill({
      placeholders: ALL,
      settings: { companyName: 'OFP Turismo', companyDocument: '12.345.678/0001-90', companyAddress: 'Rua A, 1' },
      contact: { name: 'Ana Souza', phone: '5511999990000', email: 'ana@x.com' },
      now,
    });
    expect(values).toEqual({
      '[Razão Social da Agência]': 'OFP Turismo',
      '[CNPJ da Agência]': '12.345.678/0001-90',
      '[Endereço da Agência]': 'Rua A, 1',
      '[Nome do Cliente]': 'Ana Souza',
      '[Telefone do Cliente]': '5511999990000',
      '[E-mail do Cliente]': 'ana@x.com',
      '[Dia]': '15',
      '[Mês]': 'novembro',
      '[Ano]': '2026',
    });
  });

  it('não inventa cidade, CPF, endereço do cliente nem representante', () => {
    const values = buildAutofill({ placeholders: ALL, settings: null, contact: null, now });
    expect(values).not.toHaveProperty('[Cidade]');
    expect(values).not.toHaveProperty('[CPF do Cliente]');
    expect(values).not.toHaveProperty('[Endereço do Cliente]');
    expect(values).not.toHaveProperty('[Representante Legal da Agência]');
  });

  it('omite campos cujo dado está vazio', () => {
    const values = buildAutofill({
      placeholders: ['[Nome do Cliente]', '[Razão Social da Agência]'],
      settings: { companyName: '   ' },
      contact: { name: null },
      now,
    });
    expect(values).toEqual({});
  });

  it('campo com nome de propriedade do protótipo não quebra', () => {
    expect(buildAutofill({ placeholders: ['[constructor]', '[toString]'], settings: null, contact: null, now })).toEqual({});
  });

  it('não devolve campo que o modelo não tem', () => {
    const values = buildAutofill({ placeholders: ['[Dia]'], settings: null, contact: { name: 'Ana' }, now });
    expect(values).toEqual({ '[Dia]': '15' });
  });
});

describe('resolveAutofill — camadas e origens', () => {
  const now = new Date('2026-11-15T15:00:00Z');
  const placeholders = [
    '[Cidade]', '[Razão Social da Agência]', '[CNPJ da Agência]', '[Nome do Cliente]', '[CPF do Cliente]',
    '[Dia]', '[Valor Total]',
  ];

  it('fieldDefaults < colunas da empresa < contato/lembrados < data, com origem de cada valor', () => {
    const out = resolveAutofill({
      placeholders,
      settings: { companyName: 'OFP Ltda', companyDocument: null },
      contact: { name: 'Ana' },
      saved: { '[CPF do Cliente]': '123' },
      defaults: {
        '[Cidade]': 'São Paulo',
        '[Razão Social da Agência]': 'Nome antigo',
        '[CNPJ da Agência]': '00.000/0001-00',
        '[Dia]': '99',
        '[Fora do Modelo]': 'x',
      },
      now,
    });
    expect(out.values).toEqual({
      '[Cidade]': 'São Paulo',
      '[Razão Social da Agência]': 'OFP Ltda',
      '[CNPJ da Agência]': '00.000/0001-00',
      '[Nome do Cliente]': 'Ana',
      '[CPF do Cliente]': '123',
      '[Dia]': '15',
    });
    expect(out.sources).toEqual({
      '[Cidade]': 'default',
      '[Razão Social da Agência]': 'agency',
      '[CNPJ da Agência]': 'default',
      '[Nome do Cliente]': 'contact',
      '[CPF do Cliente]': 'saved',
      '[Dia]': 'date',
    });
  });

  it('valor só com espaço numa camada alta não apaga a de baixo', () => {
    const out = resolveAutofill({
      placeholders: ['[Razão Social da Agência]'],
      settings: { companyName: '   ' },
      contact: null,
      defaults: { '[Razão Social da Agência]': 'Padrão' },
      now,
    });
    expect(out).toEqual({ values: { '[Razão Social da Agência]': 'Padrão' }, sources: { '[Razão Social da Agência]': 'default' } });
  });

  it('chave "[constructor]" não acha o protótipo', () => {
    const out = resolveAutofill({ placeholders: ['[constructor]'], settings: null, contact: null, now });
    expect(out.values).toEqual({});
  });
});
