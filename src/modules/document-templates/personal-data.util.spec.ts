import {
  MAX_PERSONAL_VALUE_LENGTH,
  PERSONAL_DATA_SELECT,
  personalDataToValues,
  valuesToPersonalData,
} from './personal-data.util';

describe('personalDataToValues', () => {
  it('converte colunas em campos do modelo, sem vazios', () => {
    expect(personalDataToValues({ cpf: '123', rg: ' ', address: null, birthDate: '05/03/1990' })).toEqual({
      '[CPF do Cliente]': '123',
      '[Data de Nascimento do Cliente]': '05/03/1990',
    });
  });

  it('linha ausente vira objeto vazio', () => {
    expect(personalDataToValues(null)).toEqual({});
  });
});

describe('valuesToPersonalData', () => {
  it('pega só campos mapeados e não vazios, aparados', () => {
    expect(
      valuesToPersonalData({
        '[CPF do Cliente]': ' 123.456.789-00 ',
        '[RG do Cliente]': '',
        '[Estado Civil do Cliente]': 'casada',
        '[Valor Total]': 'R$ 10',
      }),
    ).toEqual({ cpf: '123.456.789-00', maritalStatus: 'casada' });
  });

  it('corta valor longo demais', () => {
    const out = valuesToPersonalData({ '[Endereço do Cliente]': 'x'.repeat(MAX_PERSONAL_VALUE_LENGTH + 10) });
    expect(out.address).toHaveLength(MAX_PERSONAL_VALUE_LENGTH);
  });
});

describe('PERSONAL_DATA_SELECT', () => {
  it('seleciona as seis colunas', () => {
    expect(PERSONAL_DATA_SELECT).toEqual({
      cpf: true, rg: true, address: true, maritalStatus: true, nationality: true, birthDate: true,
    });
  });
});
