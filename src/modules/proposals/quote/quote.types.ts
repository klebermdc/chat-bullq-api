/**
 * Cotação por link — formato combinado com o web (contrato v1). Não existe
 * campo para CPF nem nome de viajante, de propósito.
 */
export interface QuoteItem {
  provider: string;
  title: string;
  /** YYYY-MM-DD */
  startDate: string | null;
  /** YYYY-MM-DD (igual a startDate se for um dia só) */
  endDate: string | null;
  description: string | null;
  adults: number;
  children: number;
  /** Preço unitário, só quando visível no print. */
  priceAdult: number | null;
  priceChild: number | null;
  total: number;
  cancellationPolicy: string | null;
  /** Nome do hotel como está no print, quando o item é hospedagem. */
  hotelName: string | null;
  /**
   * País do hotel (ISO, 2 letras) lido do print. Só serve para a busca da
   * ficha: sai do item antes de a cotação ir para o editor.
   */
  hotelCountry?: string | null;
  /** Ficha do hotel (LiteAPI, só conteúdo — nunca preço). */
  hotel: QuoteHotel | null;
}

/**
 * Ficha resumida do hotel, em português, vinda do cadastro da LiteAPI. Não
 * tem campo de preço de propósito: o valor é sempre o do print.
 */
export interface QuoteHotel {
  id: string;
  name: string;
  stars: number | null;
  address: string | null;
  summary: string;
  amenities: string[];
  /** "16h" */
  checkin: string | null;
  checkout: string | null;
  /** https://static.cupid.travel/... */
  photos: string[];
}

export interface QuoteInstallments {
  count: number;
  value: number;
}

export interface QuoteData {
  items: QuoteItem[];
  currency: string;
  total: number;
  pixTotal: number | null;
  installments: QuoteInstallments | null;
  notes: string | null;
}

export type QuoteTermsBlock = { kind: 'p'; text: string } | { kind: 'list'; items: string[] };

/** Regras gerais da cotação (iguais para todas): câmbio e cancelamento. */
export interface QuoteTerms {
  exchangeNotice: string;
  cancellation: { title: string; revisedAt: string; blocks: QuoteTermsBlock[] };
}

export type QuoteStatus = 'ACTIVE' | 'EXPIRED';

export interface QuoteCompany {
  name: string;
  tagline: string;
  cnpj: string;
  instagram: string;
  facebook: string;
  site: string;
  hours: string;
}

/** Resposta de `GET /public/quotes/:token`. Nada de ids internos. */
export interface PublicQuoteView {
  status: QuoteStatus;
  code: string;
  customerName: string | null;
  seller: { name: string; whatsapp: string | null };
  createdAt: string;
  expiresAt: string;
  quote: QuoteData;
  company: QuoteCompany;
  terms: QuoteTerms;
}
