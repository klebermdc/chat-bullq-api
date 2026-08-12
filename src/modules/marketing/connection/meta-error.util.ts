import { AdConnectionStatus } from '@prisma/client';

/**
 * `code: 190` é OAuthException. O subcódigo diz se o usuário tirou a permissão
 * (não adianta tentar de novo, precisa reconectar) ou se a sessão apenas
 * venceu. Os dois pedem ação humana, mas o texto na tela muda.
 */
const REVOKED_SUBCODES = new Set([458, 459, 466]);

/** Limites de requisição da Graph e da Marketing API. */
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613, 80000, 80003, 80004, 80014]);

export type MetaFailure =
  | { kind: 'credential'; status: AdConnectionStatus; message: string }
  | { kind: 'rate_limit'; message: string }
  | { kind: 'transient'; message: string };

interface GraphErrorBody {
  code?: number;
  error_subcode?: number;
  message?: string;
}

function extract(err: unknown): GraphErrorBody | null {
  const body = (err as any)?.response?.data?.error;
  return body && typeof body === 'object' ? (body as GraphErrorBody) : null;
}

export function classifyMetaError(err: unknown): MetaFailure {
  const graph = extract(err);
  const message = graph?.message ?? (err as Error)?.message ?? 'erro desconhecido';

  if (!graph || typeof graph.code !== 'number') {
    return { kind: 'transient', message };
  }

  if (graph.code === 190 || graph.code === 102) {
    const status =
      graph.error_subcode !== undefined && REVOKED_SUBCODES.has(graph.error_subcode)
        ? AdConnectionStatus.REVOKED
        : AdConnectionStatus.INVALID_TOKEN;
    return { kind: 'credential', status, message };
  }

  if (RATE_LIMIT_CODES.has(graph.code)) {
    return { kind: 'rate_limit', message };
  }

  return { kind: 'transient', message };
}
