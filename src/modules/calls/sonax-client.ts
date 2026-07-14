import { Injectable } from '@nestjs/common';

export interface Click2CallParams {
  baseUrl: string;
  numero: string;
  ramal: string;
  token: string;
  var1: string;
}

type FetchFn = typeof fetch;

/**
 * Cliente HTTP fino para o discador Sonax. `fetch` é injetável para teste.
 * Timeout curto (8s): o disparo é "fire-and-forget" — a Sonax só confirma
 * que aceitou o comando; o resultado da ligação chega depois via webhook.
 */
@Injectable()
export class SonaxClient {
  constructor(private readonly fetchFn: FetchFn = fetch) {}

  async click2call(p: Click2CallParams): Promise<void> {
    const qs = new URLSearchParams({
      numero: p.numero,
      ramal: p.ramal,
      token: p.token,
      var_1: p.var1,
    });
    const url = `${p.baseUrl}?${qs.toString()}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await this.fetchFn(url, { method: 'GET', signal: ctrl.signal });
      if (!res.ok) {
        throw new Error(`Sonax respondeu ${res.status}`);
      }
    } finally {
      clearTimeout(t);
    }
  }
}
