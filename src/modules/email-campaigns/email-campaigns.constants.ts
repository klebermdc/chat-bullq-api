export const CAMPAIGN_SEND_QUEUE = 'email-campaign-send';

/**
 * Envios por segundo. Com base de ~5 mil, uma campanha inteira sai em ~10 min.
 * Fica bem abaixo de qualquer limite de taxa do Resend e evita a rajada que
 * dispara filtro de spam do lado do destinatário.
 */
export const SEND_RATE_PER_SECOND = 8;

/** Tentativas por mensagem antes de desistir. */
export const SEND_ATTEMPTS = 3;
