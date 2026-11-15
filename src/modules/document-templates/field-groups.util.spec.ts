import { classifyPlaceholder, friendlyLabel, groupPlaceholders, normalizeFieldName } from './field-groups.util';

describe('classifyPlaceholder', () => {
  it.each(['[Dia]', '[Mês]', '[Ano]', '[Mes]', '[ MÊS ]'])('%s é auto', (name) => {
    expect(classifyPlaceholder(name)).toBe('auto');
  });

  it.each([
    '[Razão Social da Agência]', '[CNPJ da Agência]', '[Endereço da Agência]',
    '[Representante Legal da Agência]', '[Cadastur da Agência]', '[Cidade]', '[UF]',
    '[Percentual da Multa]', '[Percentual da RAV]', '[Percentual da Multa até 60 Dias]',
    '[Prazo de Cancelamento]', '[cnpj da agencia]',
  ])('%s é agency', (name) => {
    expect(classifyPlaceholder(name)).toBe('agency');
  });

  it.each([
    '[Nome do Cliente]', '[CPF do Cliente]', '[RG do Cliente]', '[Endereço do Cliente]',
    '[Estado Civil do Cliente]', '[Nome do Menor]', '[Data de Nascimento do Menor]',
    '[Nome do Responsável Legal]', '[CPF do Responsavel Legal]', '[Nomes dos Passageiros]',
    '[Quantidade de Passageiros]', '[nome do CLIENTE]',
  ])('%s é client', (name) => {
    expect(classifyPlaceholder(name)).toBe('client');
  });

  it.each([
    '[Valor Total]', '[Valor Total por Extenso]', '[Destino]', '[Data de Ida]', '[Nome do Hotel]',
    '[CPF da Primeira Testemunha]', '[Forma de Pagamento]', '[Cidade de Embarque]',
  ])('%s é seller', (name) => {
    expect(classifyPlaceholder(name)).toBe('seller');
  });
});

describe('friendlyLabel', () => {
  it.each([
    ['[CPF do Cliente]', 'CPF'],
    ['[RG do Cliente]', 'RG'],
    ['[Nome do Cliente]', 'Nome completo'],
    ['[Endereço do Cliente]', 'Endereço completo com CEP'],
    ['[Estado Civil do Cliente]', 'Estado civil'],
    ['[Data de Nascimento do Cliente]', 'Data de nascimento'],
    ['[Nome do Menor]', 'Nome do menor'],
    ['[CPF do Responsável Legal]', 'CPF do responsável legal'],
    ['[Nomes dos Passageiros]', 'Nomes dos passageiros'],
    ['Telefone do cliente', 'Telefone'],
  ])('%s → %s', (name, label) => {
    expect(friendlyLabel(name)).toBe(label);
  });
});

describe('groupPlaceholders', () => {
  it('separa por grupo mantendo a ordem do modelo', () => {
    const groups = groupPlaceholders([
      '[Nome do Cliente]', '[Dia]', '[Valor Total]', '[CNPJ da Agência]', '[CPF do Cliente]', '[Ano]',
    ]);
    expect(groups).toEqual({
      client: ['[Nome do Cliente]', '[CPF do Cliente]'],
      seller: ['[Valor Total]'],
      agency: ['[CNPJ da Agência]'],
      auto: ['[Dia]', '[Ano]'],
    });
  });
});

describe('normalizeFieldName', () => {
  it('tira colchete, acento, caixa e espaço duplo', () => {
    expect(normalizeFieldName('[ Endereço   da AGÊNCIA ]')).toBe('endereco da agencia');
  });
});
