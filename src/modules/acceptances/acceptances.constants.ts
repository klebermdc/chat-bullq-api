/**
 * Teto por IP para rotas que disparam trabalho caro ou mensagem ao cliente
 * (reenvio de link no WhatsApp, PDF gerado na hora). Folgado para atendente,
 * apertado para script: cada chamada é um Chromium ou uma mensagem paga.
 */
export const LIMITE_REENVIO = { ttl: 60_000, limit: 20 };
export const LIMITE_PDF = { ttl: 60_000, limit: 30 };
