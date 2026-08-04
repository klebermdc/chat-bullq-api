import { EmailSubscriberStatus, Prisma } from '@prisma/client';

/**
 * Filtro de público de uma campanha, como salvo em `EmailCampaign.audienceFilter`
 * (campo `Json`, digitado só na fronteira — daí `parseAudienceFilter`).
 *
 * Filtro vazio (`{}`) significa "toda a base inscrita": é o comportamento
 * atual, e mudar isso silenciosamente quebraria campanha já criada.
 */
export interface AudienceFilter {
  tagIds?: string[];
  categories?: string[];
  suppliers?: string[];
  purchasedSince?: string; // ISO
  purchasedUntil?: string; // ISO
  minSpent?: number;
  minOrders?: number;
}

function parseDate(value: unknown, field: string): Date {
  if (typeof value !== 'string') {
    throw new Error(`${field}: precisa ser uma data em texto (ISO)`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field}: data inválida "${value}"`);
  }
  return date;
}

function parseNonNegativeNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${field}: precisa ser um número`);
  }
  if (value < 0) {
    throw new Error(`${field}: não pode ser negativo`);
  }
  return value;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new Error(`${field}: precisa ser uma lista de texto`);
  }
  return value;
}

/**
 * Valida o `Json` cru vindo do banco (ou do corpo da requisição) e devolve
 * um `AudienceFilter` tipado. Lança em vez de silenciosamente ignorar campo
 * malformado — um filtro que não filtra o que o operador pediu é pior que
 * um erro explícito.
 */
export function parseAudienceFilter(raw: unknown): AudienceFilter {
  if (raw == null || typeof raw !== 'object') return {};
  const input = raw as Record<string, unknown>;
  const filter: AudienceFilter = {};

  if (input.tagIds !== undefined) filter.tagIds = parseStringArray(input.tagIds, 'tagIds');
  if (input.categories !== undefined) {
    filter.categories = parseStringArray(input.categories, 'categories');
  }
  if (input.suppliers !== undefined) filter.suppliers = parseStringArray(input.suppliers, 'suppliers');
  if (input.purchasedSince !== undefined) {
    filter.purchasedSince = parseDate(input.purchasedSince, 'purchasedSince').toISOString();
  }
  if (input.purchasedUntil !== undefined) {
    filter.purchasedUntil = parseDate(input.purchasedUntil, 'purchasedUntil').toISOString();
  }
  if (input.minSpent !== undefined) filter.minSpent = parseNonNegativeNumber(input.minSpent, 'minSpent');
  if (input.minOrders !== undefined) {
    filter.minOrders = parseNonNegativeNumber(input.minOrders, 'minOrders');
  }

  return filter;
}

/**
 * Monta o `where` do Prisma para `EmailSubscriber`. Usada tanto pela
 * contagem quanto pelo disparo — a MESMA função, sempre: duas implementações
 * divergem com o tempo, e contagem que mente é pior que não ter contagem.
 *
 * Regra que não se negocia: `status: SUBSCRIBED` entra sempre, e nada vindo
 * do filtro pode sobrescrever isso. O portão de supressão é a última palavra.
 */
export function buildAudienceWhere(
  organizationId: string,
  filter: AudienceFilter,
): Prisma.EmailSubscriberWhereInput {
  const where: Prisma.EmailSubscriberWhereInput = {
    organizationId,
    status: EmailSubscriberStatus.SUBSCRIBED,
  };

  if (filter.categories?.length) {
    where.categories = { hasSome: filter.categories };
  }
  if (filter.suppliers?.length) {
    where.suppliers = { hasSome: filter.suppliers };
  }
  if (filter.minSpent !== undefined) {
    where.totalSpent = { gte: filter.minSpent };
  }
  if (filter.minOrders !== undefined) {
    where.orderCount = { gte: filter.minOrders };
  }
  if (filter.purchasedSince || filter.purchasedUntil) {
    where.lastPurchaseAt = {
      ...(filter.purchasedSince ? { gte: new Date(filter.purchasedSince) } : {}),
      ...(filter.purchasedUntil ? { lte: new Date(filter.purchasedUntil) } : {}),
    };
  }
  if (filter.tagIds?.length) {
    where.tags = { some: { tagId: { in: filter.tagIds } } };
  }

  // `status` sempre por último e fora de qualquer condição acima: nenhum
  // ramo deste função pode sobrescrevê-lo.
  where.status = EmailSubscriberStatus.SUBSCRIBED;

  return where;
}
