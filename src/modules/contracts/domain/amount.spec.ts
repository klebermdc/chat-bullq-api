import { parseAmount } from './amount';

describe('parseAmount', () => {
  it.each([
    ['2190,00', { currency: 'BRL', value: 2190 }],
    ['2.190,50', { currency: 'BRL', value: 2190.5 }],
    ['R$ 1.234,56', { currency: 'BRL', value: 1234.56 }],
    ['748.5', { currency: 'BRL', value: 748.5 }],
    ['$ 150.00', { currency: 'USD', value: 150 }],
    ['$1,050.00', { currency: 'USD', value: 1050 }],
  ])('%s', (input, expected) => {
    expect(parseAmount(input)).toEqual(expected);
  });

  it('texto sem número devolve null', () => {
    expect(parseAmount('a combinar')).toBeNull();
  });
});
