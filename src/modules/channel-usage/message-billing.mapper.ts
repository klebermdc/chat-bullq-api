/**
 * Mapeamento puro "status da Meta → linha de cobrança". Compartilhado entre o
 * caminho ao vivo (`ChannelUsageService.recordMessageBilling`) e o backfill
 * (`scripts/backfill-whatsapp-message-billing.ts`), pra os dois gravarem igual.
 */
export const UNKNOWN_CATEGORY = 'unknown';

export interface BillingStatusInput {
  externalMessageId?: string;
  timestamp: Date;
  pricing?: {
    billable?: boolean;
    category?: string;
    pricingModel?: string;
    type?: string;
  };
}

export interface BillingRow {
  externalMessageId: string;
  category: string;
  pricingType: string | null;
  billable: boolean;
  pricingModel: string | null;
  statusAt: Date;
}

export interface WebhookBillingStatus {
  /** `value.metadata.phone_number_id` — resolve o canal quando o evento não tem. */
  phoneNumberId: string | null;
  row: BillingRow;
}

const EPOCH_SECONDS_TO_MS = 1000;

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Uma linha por wamid; null quando o status não carrega `pricing`. */
export function toBillingRow(status: BillingStatusInput): BillingRow | null {
  const pricing = status.pricing;
  const externalMessageId = textOrNull(status.externalMessageId);
  if (!pricing || !externalMessageId) return null;
  if (!(status.timestamp instanceof Date)) return null;
  if (Number.isNaN(status.timestamp.getTime())) return null;

  return {
    externalMessageId,
    category: textOrNull(pricing.category) ?? UNKNOWN_CATEGORY,
    pricingType: textOrNull(pricing.type),
    // Só é cobrável o que a Meta marcou explicitamente como cobrável.
    billable: pricing.billable === true,
    pricingModel: textOrNull(pricing.pricingModel),
    statusAt: status.timestamp,
  };
}

/**
 * Argumentos do upsert idempotente por (canal, wamid).
 * No update só entram os campos que o payload trouxe de fato (mesma regra do
 * `recordWindow`): um status posterior sem dado não regride a linha. `billable`
 * só entra quando é `true` — uma linha já cobrável nunca volta a grátis.
 * `statusAt` fica com o 1º status que trouxe `pricing`.
 */
export function buildBillingUpsertArgs(
  organizationId: string,
  channelId: string,
  row: BillingRow,
) {
  const update: {
    category?: string;
    pricingType?: string;
    pricingModel?: string;
    billable?: true;
  } = {};
  if (row.category !== UNKNOWN_CATEGORY) update.category = row.category;
  if (row.pricingType != null) update.pricingType = row.pricingType;
  if (row.pricingModel != null) update.pricingModel = row.pricingModel;
  if (row.billable) update.billable = true;

  return {
    where: {
      uq_billing_channel_message: {
        channelId,
        externalMessageId: row.externalMessageId,
      },
    },
    create: { organizationId, channelId, ...row },
    update,
  };
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function rawStatusToRow(raw: any): BillingRow | null {
  if (!raw || typeof raw !== 'object' || !raw.pricing) return null;
  const seconds = Number.parseInt(String(raw.timestamp), 10);
  if (!Number.isFinite(seconds)) return null;
  return toBillingRow({
    externalMessageId: raw.id,
    timestamp: new Date(seconds * EPOCH_SECONDS_TO_MS),
    pricing: {
      billable: raw.pricing.billable,
      category: raw.pricing.category,
      pricingModel: raw.pricing.pricing_model,
      type: raw.pricing.type,
    },
  });
}

/**
 * Lê um `webhook_events.raw_payload` do WhatsApp Cloud API
 * (`entry[].changes[].value.statuses[]`) e devolve as linhas de cobrança dos
 * status que trazem `pricing`. Nunca lança: payload estranho devolve [].
 */
export function extractBillingFromWebhookPayload(
  payload: unknown,
): WebhookBillingStatus[] {
  const found: WebhookBillingStatus[] = [];
  for (const entry of asArray((payload as any)?.entry)) {
    for (const change of asArray(entry?.changes)) {
      const value = change?.value;
      const phoneNumberId = textOrNull(value?.metadata?.phone_number_id);
      for (const rawStatus of asArray(value?.statuses)) {
        const row = rawStatusToRow(rawStatus);
        if (row) found.push({ phoneNumberId, row });
      }
    }
  }
  return found;
}
