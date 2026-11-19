/**
 * Câmbio do dólar nas operadoras, lido do que cada uma mostra ao agente.
 *
 * - JT (Just Travel): API pública que o próprio site usa no topo da página.
 * - SC (Suncoast): o valor vem escrito no cabeçalho da página inicial.
 * - AZ (Azul Viagens): o site bloqueia robôs (Akamai); o atendente consulta
 *   pelo link. Decisão do Kleber em 19/11/2026.
 */

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface OperatorDef {
  code: string;
  name: string;
  /** Página que o atendente abre ao clicar na sigla. */
  url: string;
  source: 'just-travel-api' | 'suncoast-html' | 'link';
}

export interface FetchedRate {
  value: number;
  /** Data de atualização como a operadora informa (texto para exibir). */
  sourceUpdatedLabel: string | null;
}

export const OPERATORS: readonly OperatorDef[] = [
  { code: 'JT', name: 'Just Travel', url: 'https://reservas.orlandofastpass.com.br/pt', source: 'just-travel-api' },
  { code: 'SC', name: 'Suncoast', url: 'https://orlandofastpass.suncoastusa.com.br/', source: 'suncoast-html' },
  { code: 'AZ', name: 'Azul Viagens', url: 'https://www.azulviagens.com.br/', source: 'link' },
];

const JT_API_URL = 'https://hermes.justtraveltour.com/api';
const JT_QUERY = '{ getCurrencyByShortName(shortName: REAL) { value updatedAt } }';
const USER_AGENT = 'Mozilla/5.0 (compatible; Sendtur/1.0; +https://sendtur.com.br)';
const TIMEOUT_MS = 20_000;
/** Faixa plausível de US$ 1 em reais; fora disso a leitura veio errada. */
const MIN_RATE = 1;
const MAX_RATE = 20;

export function toRate(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(n) || n < MIN_RATE || n > MAX_RATE) return null;
  return n;
}

/** "2026-11-18 23:03:40" → "18/11/2026 23:03". */
function formatJtDate(raw: unknown): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(String(raw ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : null;
}

export function parseJustTravel(json: unknown): FetchedRate {
  const node = (json as { data?: { getCurrencyByShortName?: { value?: unknown; updatedAt?: unknown } } })
    ?.data?.getCurrencyByShortName;
  const value = toRate(node?.value);
  if (value === null) throw new Error('JT: resposta sem câmbio');
  return { value, sourceUpdatedLabel: formatJtDate(node?.updatedAt) };
}

const SC_PATTERN = /R\$\s*([0-9]+[.,][0-9]+)(?:\s|&emsp;|&nbsp;)*atualizado em\s*([^<]+?)\s*</i;

export function parseSuncoast(html: string): FetchedRate {
  const m = SC_PATTERN.exec(html);
  const value = toRate(m?.[1]);
  if (!m || value === null) throw new Error('SC: câmbio não encontrado na página');
  return { value, sourceUpdatedLabel: m[2].trim() || null };
}

async function request(op: OperatorDef, fetchImpl: FetchLike, url: string, init: RequestInit): Promise<Response> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${op.code}: HTTP ${res.status}`);
  return res;
}

export async function fetchOperatorRate(op: OperatorDef, fetchImpl: FetchLike = fetch): Promise<FetchedRate> {
  switch (op.source) {
    case 'just-travel-api': {
      const res = await request(op, fetchImpl, JT_API_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': USER_AGENT },
        body: JSON.stringify({ query: JT_QUERY }),
      });
      return parseJustTravel(await res.json().catch(() => null));
    }
    case 'suncoast-html': {
      const res = await request(op, fetchImpl, op.url, {
        method: 'GET',
        headers: { 'user-agent': USER_AGENT, accept: 'text/html' },
      });
      return parseSuncoast(await res.text());
    }
    default:
      throw new Error(`${op.code}: operadora sem busca automática`);
  }
}
