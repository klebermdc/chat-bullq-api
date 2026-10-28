import { Injectable, Logger } from '@nestjs/common';
import type { QuoteData, QuoteHotel, QuoteItem } from '../quote.types';
import { descriptionText, hotelSearchQueries, looksPortuguese, pickHotelId, summarizeDescription, toQuoteHotel } from './hotel-content';
import { LiteapiClient } from './liteapi.client';

/** Resume em pt-BR um texto de hotel que veio em outra língua (IA). */
export type HotelSummarizer = (hotelName: string, text: string) => Promise<string>;

/** A LiteAPI exige o país. Sem país no print, é Orlando (o caso comum da agência). */
const DEFAULT_COUNTRY = 'US';
/** Nos EUA, primeiro procura em Orlando; os resorts Disney às vezes estão em "Lake Buena Vista". */
const FIRST_CITY = 'Orlando';

/**
 * Completa os itens de hotel da cotação lida dos prints com a ficha do hotel
 * (descrição curta, comodidades, horários e fotos). Nunca falha a leitura:
 * hotel não achado ou LiteAPI fora do ar = item sem ficha.
 */
@Injectable()
export class HotelLookupService {
  private readonly logger = new Logger(HotelLookupService.name);

  constructor(private readonly client: LiteapiClient) {}

  async enrich(quote: QuoteData, summarize?: HotelSummarizer): Promise<QuoteData> {
    if (!this.client.enabled || !quote.items.some((i) => i.hotelName)) return quote;
    // Em sequência: a chave de sandbox aceita só 5 chamadas por segundo.
    const items: QuoteItem[] = [];
    for (const { hotelCountry, ...item } of quote.items) {
      const country = hotelCountry ?? DEFAULT_COUNTRY;
      items.push(item.hotelName && !item.hotel ? { ...item, hotel: await this.find(item.hotelName, country, summarize) } : item);
    }
    return { ...quote, items };
  }

  async find(hotelName: string, country: string, summarize?: HotelSummarizer): Promise<QuoteHotel | null> {
    try {
      const id = await this.findId(hotelName, country);
      if (!id) {
        this.logger.log(`hotel_not_found name="${hotelName}" country=${country}`);
        return null;
      }
      const raw = await this.client.getHotel(id);
      const hotel = toQuoteHotel(raw);
      if (!hotel || looksPortuguese(hotel.summary)) return hotel;
      return { ...hotel, summary: await this.portugueseSummary(hotel, raw, summarize) };
    } catch (err) {
      this.logger.warn(`hotel_lookup_failed name="${hotelName}": ${(err as Error).message}`);
      return null;
    }
  }

  /** Nos EUA, cada busca primeiro em Orlando e, no fim, a mais exata sem cidade. Fora, só pelo país. */
  private async findId(hotelName: string, country: string): Promise<string | null> {
    const city = country === DEFAULT_COUNTRY ? FIRST_CITY : null;
    for (const query of hotelSearchQueries(hotelName)) {
      const id = pickHotelId(hotelName, await this.client.searchHotels(query, country, city));
      if (id) return id;
    }
    if (!city) return null;
    return pickHotelId(hotelName, await this.client.searchHotels(hotelName, country, null));
  }

  /** Descrição em inglês: a IA resume em português; se falhar, uma linha neutra. */
  private async portugueseSummary(hotel: QuoteHotel, raw: unknown, summarize?: HotelSummarizer): Promise<string> {
    const fallback = hotel.stars ? `${hotel.name}, hotel ${hotel.stars} estrelas.` : `${hotel.name}.`;
    if (!summarize) return fallback;
    const description = descriptionText((raw as { hotelDescription?: unknown } | null)?.hotelDescription);
    try {
      // Passa de novo pelo resumo: corta no limite e tira qualquer frase com valor.
      const text = summarizeDescription(`<p>${await summarize(hotel.name, description)}</p>`);
      return text && looksPortuguese(text) ? text : fallback;
    } catch (err) {
      this.logger.warn(`hotel_summary_failed id=${hotel.id}: ${(err as Error).message}`);
      return fallback;
    }
  }
}
