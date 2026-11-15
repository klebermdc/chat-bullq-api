import {
  computeExtensoFields,
  extensoBaseField,
  integerToWords,
  moneyToWords,
  parseBrl,
} from './money-words.util';

describe('parseBrl', () => {
  it.each([
    ['R$ 8.500,00', 850000],
    ['R$8.500,00', 850000],
    ['8.500', 850000],
    ['8500', 850000],
    ['8500,5', 850050],
    ['8500.50', 850050],
    ['1.234.567,89', 123456789],
    ['0,01', 1],
    ['  R$  12,30 ', 1230],
  ])('%s → %d centavos', (text, cents) => {
    expect(parseBrl(text)).toBe(cents);
  });

  it.each(['', 'abc', 'R$', '8.50.0', '-10', '10,999', 'US$ 10', '1.000.000.000.000,00', '8,500.00'])(
    '%s não é valor',
    (text) => {
      expect(parseBrl(text)).toBeNull();
    },
  );
});

describe('integerToWords', () => {
  it.each([
    [0, 'zero'],
    [1, 'um'],
    [14, 'quatorze'],
    [21, 'vinte e um'],
    [100, 'cem'],
    [101, 'cento e um'],
    [110, 'cento e dez'],
    [999, 'novecentos e noventa e nove'],
    [1000, 'mil'],
    [1001, 'mil e um'],
    [1100, 'mil e cem'],
    [1500, 'mil e quinhentos'],
    [1520, 'mil quinhentos e vinte'],
    [2000, 'dois mil'],
    [8500, 'oito mil e quinhentos'],
    [21_000, 'vinte e um mil'],
    [100_000, 'cem mil'],
    [123_456, 'cento e vinte e três mil quatrocentos e cinquenta e seis'],
    [1_000_000, 'um milhão'],
    [1_500_000, 'um milhão e quinhentos mil'],
    [2_000_000, 'dois milhões'],
    [1_000_500, 'um milhão e quinhentos'],
    [1_234_567, 'um milhão duzentos e trinta e quatro mil quinhentos e sessenta e sete'],
    [1_000_000_000, 'um bilhão'],
    [3_000_000_001, 'três bilhões e um'],
  ])('%d → %s', (n, words) => {
    expect(integerToWords(n)).toBe(words);
  });
});

describe('moneyToWords', () => {
  it.each([
    [850000, 'oito mil e quinhentos reais'],
    [100, 'um real'],
    [200, 'dois reais'],
    [1, 'um centavo'],
    [50, 'cinquenta centavos'],
    [101, 'um real e um centavo'],
    [250, 'dois reais e cinquenta centavos'],
    [0, 'zero reais'],
    [100_000_000, 'um milhão de reais'],
    [200_000_050, 'dois milhões de reais e cinquenta centavos'],
    [150_000_000, 'um milhão e quinhentos mil reais'],
    [123456789, 'um milhão duzentos e trinta e quatro mil quinhentos e sessenta e sete reais e oitenta e nove centavos'],
  ])('%d centavos → %s', (cents, words) => {
    expect(moneyToWords(cents)).toBe(words);
  });
});

describe('extensoBaseField', () => {
  it('acha o campo-base ou devolve null', () => {
    expect(extensoBaseField('[Valor Total por Extenso]')).toBe('[Valor Total]');
    expect(extensoBaseField('[Valor da Parcela por extenso]')).toBe('[Valor da Parcela]');
    expect(extensoBaseField('[Valor Total]')).toBeNull();
  });
});

describe('computeExtensoFields', () => {
  it('calcula só os extensos com base em reais válida', () => {
    const out = computeExtensoFields(
      ['[Valor Total]', '[Valor Total por Extenso]', '[Valor da Parcela por Extenso]', '[Valor da Entrada por Extenso]'],
      { '[Valor Total]': 'R$ 8.500,00', '[Valor da Parcela]': 'a combinar' },
    );
    expect(out).toEqual({ '[Valor Total por Extenso]': 'oito mil e quinhentos reais' });
  });

  it('não muda o objeto recebido', () => {
    const values = Object.freeze({ '[Valor Total]': '100' });
    expect(computeExtensoFields(['[Valor Total por Extenso]'], values)).toEqual({ '[Valor Total por Extenso]': 'cem reais' });
  });
});
