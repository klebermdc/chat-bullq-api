import { buildDataRequestText, firstName, missingClientFields } from './data-request.util';

describe('missingClientFields', () => {
  it('lista só os sem valor e não repete rótulo', () => {
    const out = missingClientFields(
      ['[Nome do Cliente]', '[CPF do Cliente]', '[CPF do cliente]', '[RG do Cliente]', '[Nome do Menor]'],
      { '[Nome do Cliente]': 'Ana', '[RG do Cliente]': '  ' },
    );
    expect(out.fields).toEqual(['[CPF do Cliente]', '[CPF do cliente]', '[RG do Cliente]', '[Nome do Menor]']);
    expect(out.labels).toEqual(['CPF', 'RG', 'Nome do menor']);
  });

  it('nada faltando → listas vazias', () => {
    expect(missingClientFields(['[CPF do Cliente]'], { '[CPF do Cliente]': '1' })).toEqual({ fields: [], labels: [] });
  });
});

describe('firstName', () => {
  it.each([
    ['Ana Souza', 'Ana'],
    ['  Érica  ', 'Érica'],
    ['5511999990000', null],
    ['+55 11 9999', null],
    ['', null],
    [null, null],
  ])('%p → %p', (name, expected) => {
    expect(firstName(name)).toBe(expected);
  });
});

describe('buildDataRequestText', () => {
  it('cumprimenta pelo primeiro nome e lista os itens', () => {
    expect(buildDataRequestText({ contactName: 'Ana Souza', title: 'Contrato Disney', labels: ['Nome completo', 'CPF'] }))
      .toBe(
        'Olá, Ana! Para emitir seu contrato (*Contrato Disney*), me envie por favor:\n' +
        '• Nome completo\n• CPF\n' +
        'Pode mandar tudo numa mensagem só. 😊',
      );
  });

  it('sem nome usável, sem nome no cumprimento', () => {
    expect(buildDataRequestText({ contactName: '5511', title: 'T', labels: ['CPF'] })).toMatch(/^Olá! Para emitir/);
  });
});
