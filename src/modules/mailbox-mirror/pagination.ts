export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface PageRequest {
  page: number;
  limit: number;
  skip: number;
}

function toPositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** `?page=&limit=` da query, com valores sãos (limite máximo de 100). */
export function parsePage(page?: string, limit?: string): PageRequest {
  const safePage = toPositiveInt(page, 1);
  const safeLimit = Math.min(toPositiveInt(limit, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  return { page: safePage, limit: safeLimit, skip: (safePage - 1) * safeLimit };
}

export function pagination(req: PageRequest, total: number) {
  return { page: req.page, limit: req.limit, total, totalPages: Math.ceil(total / req.limit) };
}
