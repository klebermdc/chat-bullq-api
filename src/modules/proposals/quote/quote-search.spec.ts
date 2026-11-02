import { parseQuoteSearch } from './quote-search';

describe('parseQuoteSearch', () => {
  it.each(['0152', '152'])('só dígitos (%s): pode ser número da cotação ou telefone', (q) => {
    expect(parseQuoteSearch(q)).toMatchObject({ quoteNumber: 152, phoneDigits: q });
  });

  it.each(['#152', 'nº 0152', 'COT-152', 'cotação 152', 'cotacao nº 152'])('"%s" procura só o número', (q) => {
    expect(parseQuoteSearch(q)).toEqual({ quoteNumber: 152, phoneDigits: null, likePattern: null });
  });

  it('nome ou hotel vira padrão de busca, com curingas escapados', () => {
    expect(parseQuoteSearch('  Blue Tree ')).toEqual({ quoteNumber: null, phoneDigits: null, likePattern: '%Blue Tree%' });
    expect(parseQuoteSearch('50%_off')).toMatchObject({ likePattern: '%50\\%\\_off%' });
  });

  it('telefone formatado busca pelos dígitos', () => {
    expect(parseQuoteSearch('(11) 99876-5432')).toMatchObject({ phoneDigits: '11998765432', quoteNumber: null });
  });

  it('vazio não filtra; número grande demais não vira nº de cotação', () => {
    expect(parseQuoteSearch('   ')).toBeNull();
    expect(parseQuoteSearch(undefined)).toBeNull();
    expect(parseQuoteSearch('5511998765432')).toMatchObject({ quoteNumber: null, phoneDigits: '5511998765432' });
  });
});
