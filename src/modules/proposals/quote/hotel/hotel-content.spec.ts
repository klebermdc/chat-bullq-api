import {
  cleanHotelName,
  looksPortuguese,
  formatHotelTime,
  HOTEL_SUMMARY_TARGET,
  nameScore,
  pickHotelId,
  sanitizeHotel,
  summarizeDescription,
  toQuoteHotel,
  translateAmenities,
} from './hotel-content';

/** Trecho real de `/data/hotel?hotelId=lp19e6f&language=pt` (27/10/2026). */
const HYATT = {
  id: 'lp19e6f',
  name: 'Hyatt Regency Grand Cypress Resort - Free Shuttle to Theme Parks!',
  starRating: 4,
  address: 'One Grand Cypress Boulevard',
  city: 'Orlando',
  currency: 'USD',
  hotelDescription:
    '<p><strong>Amenidades Luxuosas</strong></p><p>Desfrute do máximo luxo no Hyatt Regency Grand Cypress, com um lago privado, piscina ao ar livre em estilo lagoa e um spa sereno que oferece uma variedade de tratamentos indulgentes.</p>' +
    '<p><strong>Localização Conveniente</strong></p><p>Localizado a poucos minutos do Walt Disney World e a uma curta distância de carro da Universal Studios, nosso resort em Orlando, Flórida, oferece a combinação perfeita de relaxamento e aventura para suas férias.</p>' +
    '<p><strong>Diversão para Toda a Família</strong></p><p>De esportes aquáticos e uma área de recreação infantil a golfe, há diversão para todos.</p>',
  hotelFacilities: ['Fitness center', 'Free WiFi', 'Parking', 'Swimming pool', 'Outdoor pool', 'Restaurant', 'Shuttle service', 'Pets allowed'],
  checkinCheckoutTimes: { checkin_start: '04:00 PM', checkin_end: '', checkout: '11:00 AM' },
  main_photo: 'https://static.cupid.travel/hotels/460875392.jpg',
  hotelImages: [
    { url: 'https://static.cupid.travel/hotels/481292199.jpg', urlHd: 'https://static.cupid.travel/hotels/481292199.jpg', defaultImage: false },
    { url: 'https://static.cupid.travel/hotels/460875392.jpg', urlHd: 'https://static.cupid.travel/hotels/460875392.jpg', defaultImage: true },
    { url: 'https://evil.example.com/x.jpg', urlHd: '', defaultImage: false },
  ],
};

describe('toQuoteHotel', () => {
  it('monta a ficha curta em português, sem slogan no nome e sem preço', () => {
    const hotel = toQuoteHotel(HYATT)!;

    expect(hotel).toMatchObject({
      id: 'lp19e6f',
      name: 'Hyatt Regency Grand Cypress Resort',
      stars: 4,
      address: 'One Grand Cypress Boulevard, Orlando',
      checkin: '16h',
      checkout: '11h',
      photos: ['https://static.cupid.travel/hotels/460875392.jpg', 'https://static.cupid.travel/hotels/481292199.jpg'],
    });
    expect(hotel.amenities).toEqual(['Transporte (shuttle)', 'Wi-Fi grátis', 'Piscina ao ar livre', 'Restaurante', 'Academia', 'Estacionamento']);
    expect(hotel.summary).toMatch(/^Desfrute do máximo luxo/);
    expect(hotel.summary).not.toMatch(/Amenidades Luxuosas|<|USD/);
    expect(JSON.stringify(hotel)).not.toMatch(/price|rate|currency|USD/i);
  });

  it('sem descrição não há ficha', () => {
    expect(toQuoteHotel({ ...HYATT, hotelDescription: '' })).toBeNull();
  });
});

describe('summarizeDescription', () => {
  it('para em frase inteira perto do alvo', () => {
    const out = summarizeDescription(HYATT.hotelDescription);
    expect(out.length).toBeLessThanOrEqual(HOTEL_SUMMARY_TARGET);
    expect(out.endsWith('.')).toBe(true);
  });
});

describe('formatHotelTime / cleanHotelName / translateAmenities', () => {
  it.each([
    ['04:00 PM', '16h'],
    ['03:30 PM', '15h30'],
    ['12:00 PM', '12h'],
    ['11:00 AM', '11h'],
    ['15:00', '15h'],
    ['', null],
  ])('%s → %s', (input, out) => expect(formatHotelTime(input)).toBe(out));

  it('tira o slogan depois do traço', () => {
    expect(cleanHotelName("Universal's Cabana Bay Beach Resort")).toBe("Universal's Cabana Bay Beach Resort");
  });

  it('não repete "Piscina" genérica quando há uma específica', () => {
    expect(translateAmenities(['Swimming pool', 'Heated pool'])).toEqual(['Piscina aquecida']);
  });
});

describe('pickHotelId', () => {
  const list = [
    { id: 'a', name: 'Rosen Inn International Near The Parks' },
    { id: 'b', name: 'Rosen Inn Lake Buena Vista' },
    { id: 'c', name: 'Drury Inn & Suites Orlando near Universal Orlando Resort' },
  ];

  it('escolhe o nome mais parecido', () => {
    expect(pickHotelId('Rosen Inn Lake Buena Vista', list)).toBe('b');
  });

  it('não escolhe nada quando o nome não confere', () => {
    expect(pickHotelId('Hilton Garden Inn', list)).toBeNull();
    expect(nameScore('Pop Century', "Disney's Pop Century Resort")).toBe(1);
  });
});

describe('sanitizeHotel', () => {
  const hotel = toQuoteHotel(HYATT)!;

  it('aceita a ficha do contrato', () => {
    expect(sanitizeHotel(hotel)).toEqual(hotel);
  });

  it('descarta foto fora do CDN da LiteAPI e campos estranhos', () => {
    const out = sanitizeHotel({ ...hotel, photos: ['https://evil.example.com/a.jpg', hotel.photos[0]], price: 999 })!;
    expect(out.photos).toEqual([hotel.photos[0]]);
    expect(out).not.toHaveProperty('price');
  });

  it('sem resumo não há ficha', () => {
    expect(sanitizeHotel({ ...hotel, summary: '  ' })).toBeNull();
  });
});

describe('resumo sem valores e em português', () => {
  it('tira a frase que fala de taxa ou preço', () => {
    const html = '<p>Hotel a 2 km da Disney, com piscina aquecida. Resort fee de US$ 35 por noite. Transporte para os parques.</p>';
    expect(summarizeDescription(html)).toBe('Hotel a 2 km da Disney, com piscina aquecida. Transporte para os parques.');
  });

  it('não quebra frase em "6. 2 mi"', () => {
    const html = '<p>This hotel is 6. 2 mi (10 km) from Magic Kingdom. Rooms have air conditioning.</p>';
    expect(summarizeDescription(html)).toBe(
      'This hotel is 6. 2 mi (10 km) from Magic Kingdom. Rooms have air conditioning.',
    );
  });

  it('reconhece texto em inglês', () => {
    expect(looksPortuguese('Located in Lake Buena Vista, this family-friendly hotel is within a 15-minute drive of Epcot.')).toBe(false);
    expect(looksPortuguese('O resort fica ao lado do Volcano Bay e a 1 milha dos parques.')).toBe(true);
  });
});
