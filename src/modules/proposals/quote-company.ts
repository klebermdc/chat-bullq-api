import type { QuoteCompany } from './quote/quote.types';

/**
 * Dados da empresa na página e no PDF da cotação. Conferidos no site
 * orlandofastpass.com.br em 26/10/2026. Não acrescentar selo, avaliação ou
 * tempo de mercado: não existem como dado.
 */
export const QUOTE_COMPANY: Readonly<QuoteCompany> = Object.freeze({
  name: 'Orlando Fast Pass',
  tagline: 'Agência especializada em viagens para Orlando',
  cnpj: '33.142.150/0001-99',
  instagram: 'orlando.fastpass',
  facebook: 'orlandofastpass',
  site: 'https://www.orlandofastpass.com.br',
  hours: 'Segunda a sexta, das 8h às 18h',
});
