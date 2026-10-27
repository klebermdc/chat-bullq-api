import { fetchPdfPhotos, pdfPhotoUrls } from './hotel-photos';
import type { QuoteData, QuoteHotel } from '../quote.types';

const photo = (n: number) => `https://static.cupid.travel/hotels/${n}.jpg`;
const hotel = (photos: string[]): QuoteHotel => ({
  id: 'h', name: 'H', stars: null, address: null, summary: 'S', amenities: [], checkin: null, checkout: null, photos,
});
const quote = (hotels: (QuoteHotel | null)[]): QuoteData => ({
  items: hotels.map((h) => ({
    provider: 'P', title: 'T', startDate: null, endDate: null, description: null, adults: 1, children: 0,
    priceAdult: null, priceChild: null, total: 1, cancellationPolicy: null, hotelName: null, hotel: h,
  })),
  currency: 'BRL', total: 1, pixTotal: null, installments: null, notes: null,
});

describe('fotos do hotel no PDF', () => {
  it('pega as 2 primeiras de cada hotel e ignora endereço de fora', () => {
    const q = quote([hotel([photo(1), photo(2), photo(3)]), null, hotel(['https://evil.example.com/a.jpg', photo(4)])]);
    expect(pdfPhotoUrls(q)).toEqual([photo(1), photo(2), photo(4)]);
  });

  it('embute como data URI e descarta o que não é imagem ou falhou', async () => {
    const get = jest.fn(async (url: string) => {
      if (url === photo(2)) throw new Error('timeout');
      if (url === photo(3)) return { ok: true, type: 'text/html', bytes: new ArrayBuffer(4) };
      return { ok: true, type: 'image/jpeg', bytes: new Uint8Array([1, 2, 3]).buffer };
    });
    const out = await fetchPdfPhotos(quote([hotel([photo(1), photo(2)]), hotel([photo(3)])]), get);
    expect([...out.keys()]).toEqual([photo(1)]);
    expect(out.get(photo(1))).toBe('data:image/jpeg;base64,AQID');
  });
});
