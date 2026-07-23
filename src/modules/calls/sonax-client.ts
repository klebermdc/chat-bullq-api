import { Injectable, Optional } from '@nestjs/common';

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
  // @Optional(): sem esse decorator, o Nest tenta resolver o tipo `Function`
  // do param e quebra o boot da API inteira. Com ele, injeta undefined e o
  // default `= fetch` (global) assume. `fetchFn` continua injetável em teste.
  constructor(@Optional() private readonly fetchFn: FetchFn = fetch) {}

  async click2call(p: Click2CallParams): Promise<void> {
    const qs = new URLSearchParams({
      numero: p.numero,
      ramal: p.ramal,
      token: p.token,
      var_1: p.var1,
    });
    const url = `${p.baseUrl}?${qs.toString()}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await this.fetchFn(url, { method: 'GET', signal: ctrl.signal });
      if (!res.ok) {
        throw new Error(`Sonax respondeu ${res.status}`);
      }
    } catch (err: any) {
      // O click2call SEGURA a conexão HTTP durante o toque/ligação — a resposta
      // só volta no fim da chamada (que pode durar minutos). Um timeout/abort
      // NÃO é falha: a ligação foi despachada e o resultado real chega depois
      // pelo webhook de desligamento. Portanto engolimos o AbortError e tratamos
      // como "despachada". Só propagamos erros REAIS (rejeição rápida non-2xx da
      // Sonax ou falha de rede), que aí sim marcam a ligação como FAILED.
      if (err?.name === 'AbortError') return;
      throw err;
    } finally {
      clearTimeout(t);
    }
  }
}
