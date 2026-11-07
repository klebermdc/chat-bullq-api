/** Fila BullMQ que envia eventos à Conversions API da Meta (fora do request). */
export const META_CAPI_QUEUE = 'meta-capi';
export const META_CAPI_PURCHASE_JOB = 'send-purchase';

/** Janela de atribuição do clique (dias). Ganho depois disso → SKIPPED. */
export const CTWA_ATTRIBUTION_WINDOW_DAYS = 7;

/** O fbc (clique no anúncio que levou ao site) vale por até 90 dias na Meta. */
export const FBC_MAX_AGE_DAYS = 90;
