import { Injectable, Logger } from '@nestjs/common';

type Env = Readonly<Record<string, string | undefined>>;

const DEFAULT_BASE_URL = 'https://api.liteapi.travel/v3.0';
const REQUEST_TIMEOUT_MS = 8_000;
const SEARCH_LIMIT = '20';
const CONTENT_LANGUAGE = 'pt';

/**
 * Cliente da LiteAPI (Nuitee) só para CONTEÚDO de hotel: busca por nome e
 * ficha do hotel. Nenhuma rota de tarifa/reserva é chamada — o preço da
 * cotação é sempre o do print. Sem `LITEAPI_KEY`, fica desligado.
 */
@Injectable()
export class LiteapiClient {
  private readonly logger = new Logger(LiteapiClient.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(env: Env = process.env) {
    this.apiKey = (env.LITEAPI_KEY ?? '').trim();
    this.baseUrl = (env.LITEAPI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  get enabled(): boolean {
    return this.apiKey.length > 0;
  }

  /** `data` de `/data/hotels` (lista de candidatos). */
  async searchHotels(hotelName: string, countryCode: string, cityName: string | null): Promise<unknown[]> {
    const params: Record<string, string> = { countryCode, hotelName, limit: SEARCH_LIMIT };
    if (cityName) params.cityName = cityName;
    const body = await this.get('/data/hotels', params);
    return Array.isArray(body?.data) ? body.data : [];
  }

  /** `data` de `/data/hotel` (ficha completa, em português). */
  async getHotel(hotelId: string): Promise<unknown> {
    const body = await this.get('/data/hotel', { hotelId, language: CONTENT_LANGUAGE });
    return body?.data ?? null;
  }

  private async get(path: string, params: Record<string, string>): Promise<Record<string, unknown> | null> {
    const url = `${this.baseUrl}${path}?${new URLSearchParams(params).toString()}`;
    const res = await fetch(url, {
      headers: { 'X-API-Key': this.apiKey, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      // A chave nunca vai para o log; só a rota e o status.
      this.logger.warn(`liteapi_http_error path=${path} status=${res.status}`);
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  }
}
