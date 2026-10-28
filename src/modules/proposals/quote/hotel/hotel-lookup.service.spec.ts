import { HotelLookupService } from './hotel-lookup.service';
import type { LiteapiClient } from './liteapi.client';
import type { QuoteData, QuoteItem } from '../quote.types';

const item = (over: Partial<QuoteItem> = {}): QuoteItem => ({
  provider: 'Booking', title: 'Hospedagem 5 noites', startDate: '2026-12-10', endDate: '2026-12-15',
  description: null, adults: 2, children: 1, priceAdult: null, priceChild: null, total: 4200,
  cancellationPolicy: null, hotelName: null, hotel: null, ...over,
});
const quote = (items: QuoteItem[]): QuoteData => ({ items, currency: 'BRL', total: 4200, pixTotal: null, installments: null, notes: null });

const DETAILS = {
  id: 'lp6a114',
  name: "Universal's Cabana Bay Beach Resort",
  starRating: 3.5,
  hotelDescription: '<p>O resort fica ao lado do Volcano Bay e a 1 milha dos parques da Universal.</p>',
  hotelFacilities: ['Outdoor pool'],
  checkinCheckoutTimes: { checkin_start: '04:00 PM', checkout: '11:00 AM' },
  hotelImages: [],
};

function client(over: Partial<Record<keyof LiteapiClient, unknown>> = {}) {
  return {
    enabled: true,
    searchHotels: jest.fn().mockResolvedValue([{ id: 'lp6a114', name: "Universal's Cabana Bay Beach Resort" }]),
    getHotel: jest.fn().mockResolvedValue(DETAILS),
    ...over,
  } as unknown as LiteapiClient & { searchHotels: jest.Mock; getHotel: jest.Mock };
}

describe('HotelLookupService', () => {
  it('põe a ficha no item de hotel e mantém o preço do print', async () => {
    const c = client();
    const out = await new HotelLookupService(c).enrich(quote([item({ hotelName: 'Cabana Bay Beach Resort' }), item({ title: 'Ingresso' })]));

    expect(out.items[0].hotel).toMatchObject({ id: 'lp6a114', name: "Universal's Cabana Bay Beach Resort", stars: 3.5, checkin: '16h' });
    expect(out.items[0].total).toBe(4200);
    expect(out.total).toBe(4200);
    expect(out.items[1].hotel).toBeNull();
    expect(c.searchHotels).toHaveBeenCalledWith('Cabana Bay Beach Resort', 'US', 'Orlando');
  });

  it('tenta sem cidade quando não acha em Orlando', async () => {
    const c = client();
    c.searchHotels.mockResolvedValueOnce([]);
    const out = await new HotelLookupService(c).enrich(quote([item({ hotelName: 'Cabana Bay' })]));

    expect(c.searchHotels).toHaveBeenLastCalledWith('Cabana Bay', 'US', null);
    expect(out.items[0].hotel?.id).toBe('lp6a114');
  });

  it('LiteAPI fora do ar não derruba a leitura', async () => {
    const c = client({ searchHotels: jest.fn().mockRejectedValue(new Error('timeout')) });
    const out = await new HotelLookupService(c).enrich(quote([item({ hotelName: 'Cabana Bay' })]));
    expect(out.items[0].hotel).toBeNull();
  });

  it('sem chave configurada, não chama nada', async () => {
    const c = client({ enabled: false });
    const q = quote([item({ hotelName: 'Cabana Bay' })]);
    expect(await new HotelLookupService(c).enrich(q)).toBe(q);
    expect(c.searchHotels).not.toHaveBeenCalled();
  });

  it('descrição em inglês: a IA resume em português', async () => {
    const c = client({ getHotel: jest.fn().mockResolvedValue({ ...DETAILS, hotelDescription: '<p>Located next to Volcano Bay, this hotel is 1 mile from the parks.</p>' }) });
    const summarize = jest.fn().mockResolvedValue('Fica ao lado do Volcano Bay e a 1 milha dos parques da Universal.');
    const out = await new HotelLookupService(c).enrich(quote([item({ hotelName: 'Cabana Bay' })]), summarize);

    expect(summarize).toHaveBeenCalledWith("Universal's Cabana Bay Beach Resort", expect.stringContaining('Volcano Bay'));
    expect(out.items[0].hotel?.summary).toBe('Fica ao lado do Volcano Bay e a 1 milha dos parques da Universal.');
  });

  it('se a IA falhar, fica uma linha neutra em português (nunca o inglês)', async () => {
    const c = client({ getHotel: jest.fn().mockResolvedValue({ ...DETAILS, hotelDescription: '<p>Located next to Volcano Bay, this hotel is 1 mile from the parks.</p>' }) });
    const out = await new HotelLookupService(c).enrich(quote([item({ hotelName: 'Cabana Bay' })]), jest.fn().mockRejectedValue(new Error('x')));
    expect(out.items[0].hotel?.summary).toBe("Universal's Cabana Bay Beach Resort, hotel 3.5 estrelas.");
  });

  it('nome com traço e apóstrofo: acha pelo pedaço do nome', async () => {
    const c = client();
    c.searchHotels
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'lp332d67', name: 'Universal’s Endless Summer Resort – Dockside Inn and Suites' }]);
    const out = await new HotelLookupService(c).enrich(
      quote([item({ hotelName: "Universal's Endless Summer Resort - Dockside Inn and Suites" })]),
    );
    expect(c.searchHotels).toHaveBeenNthCalledWith(3, 'Dockside Inn and Suites', 'US', 'Orlando');
    expect(out.items[0].hotel?.id).toBe('lp6a114');
  });

  it('hotel fora dos EUA: busca no país do print, sem Orlando, e o país não vai para a cotação', async () => {
    const c = client();
    c.searchHotels.mockResolvedValue([{ id: 'lp3083d', name: 'Blue Tree Premium Morumbi' }]);
    const out = await new HotelLookupService(c).enrich(quote([item({ hotelName: 'Blue Tree Premium Morumbi', hotelCountry: 'BR' })]));

    expect(c.searchHotels).toHaveBeenCalledWith('Blue Tree Premium Morumbi', 'BR', null);
    expect(c.searchHotels).not.toHaveBeenCalledWith(expect.anything(), 'US', expect.anything());
    expect(out.items[0].hotel).not.toBeNull();
    expect(out.items[0]).not.toHaveProperty('hotelCountry');
  });
});
