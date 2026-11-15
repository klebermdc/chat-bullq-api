/**
 * Regras de qual pedaço da pasta IMAP ler em cada rodada. Funções puras: o
 * serviço só executa o plano.
 */

/** ~5 meses: decisão do Kleber em 15/11 (5 meses pesava demais no MinIO). */
export const INITIAL_LOOKBACK_DAYS = 150;
const DAY_MS = 24 * 60 * 60 * 1000;

export type SyncMode = 'initial' | 'incremental' | 'reset';

export interface SyncCursor {
  uidValidity: bigint | null;
  lastUid: bigint;
}

export type SyncSearch = { since: Date } | { uid: string };

export interface SyncPlan {
  mode: SyncMode;
  /** Só UIDs maiores que este entram. */
  afterUid: bigint;
  search: SyncSearch;
}

/**
 * - Primeira vez: últimos 5 meses.
 * - uidValidity igual: UIDs depois do último gravado.
 * - uidValidity mudou (pasta recriada no servidor): os UIDs antigos não valem
 *   mais; relê os 5 meses. Não duplica porque a gravação é por Message-ID.
 */
export function planSync(cursor: SyncCursor, serverUidValidity: bigint, now: Date): SyncPlan {
  const since = new Date(now.getTime() - INITIAL_LOOKBACK_DAYS * DAY_MS);
  if (cursor.uidValidity === null) {
    return { mode: 'initial', afterUid: 0n, search: { since } };
  }
  if (cursor.uidValidity !== serverUidValidity) {
    return { mode: 'reset', afterUid: 0n, search: { since } };
  }
  return {
    mode: 'incremental',
    afterUid: cursor.lastUid,
    search: { uid: `${cursor.lastUid + 1n}:*` },
  };
}

/** UIDs novos em ordem crescente, no máximo `limit` por rodada. */
export function pendingUids(found: number[], afterUid: bigint, limit: number): number[] {
  return [...found]
    .filter((uid) => BigInt(uid) > afterUid)
    .sort((a, b) => a - b)
    .slice(0, limit);
}

/**
 * Sem nada para importar na leitura inicial, o cursor vai para o fim da
 * pasta — senão a próxima rodada ("UID 1:*") traria a caixa inteira.
 */
export function cursorAfterEmptyScan(mode: SyncMode, lastUid: bigint, uidNext: number): bigint {
  if (mode === 'incremental') return lastUid;
  const end = BigInt(Math.max(uidNext - 1, 0));
  return end > lastUid ? end : lastUid;
}

export function chunk<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );
}
