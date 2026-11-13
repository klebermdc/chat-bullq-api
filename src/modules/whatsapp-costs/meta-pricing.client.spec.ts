import { MetaPricingClient, parsePricingResponse, pricingFields } from './meta-pricing.client';

const config = { get: () => undefined } as never;
const BODY = {
  currency: 'BRL',
  pricing_analytics: {
    data: [{ data_points: [{ start: 1, end: 2, pricing_category: 'SERVICE', pricing_type: 'REGULAR', volume: 10, cost: 0.35 }] }],
  },
};

describe('MetaPricingClient', () => {
  it('lê moeda e pontos da resposta', () => {
    expect(parsePricingResponse(BODY)).toEqual({
      currency: 'BRL',
      points: [{ start: 1, end: 2, category: 'SERVICE', type: 'REGULAR', volume: 10, cost: 0.35 }],
    });
    expect(parsePricingResponse({})).toEqual({ currency: 'USD', points: [] });
  });

  it('monta o campo com período em segundos e diário', () => {
    const f = pricingFields(new Date('2026-11-01T03:00:00Z'), new Date('2026-11-02T03:00:00Z'));
    expect(f).toContain('start(1793502000).end(1793588400).granularity(DAILY)');
  });

  it('chama a WABA com o token e traduz erro da Meta', async () => {
    const fetchOk = jest.fn(async () => new Response(JSON.stringify(BODY), { status: 200 }));
    const client = new MetaPricingClient(config).useFetch(fetchOk);
    await client.fetchDaily('waba1', 'tok', new Date(0), new Date(1000));
    const [url, init] = fetchOk.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/v24.0/waba1?fields=');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');

    const fetchErr = jest.fn(async () => new Response(JSON.stringify({ error: { message: 'token expirado' } }), { status: 400 }));
    await expect(new MetaPricingClient(config).useFetch(fetchErr).fetchDaily('w', 't', new Date(0), new Date(1))).rejects.toThrow(
      'Meta 400: token expirado',
    );
  });
});
