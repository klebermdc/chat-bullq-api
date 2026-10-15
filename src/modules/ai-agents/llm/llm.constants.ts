/** Default Sakana model for cheap/simple background LLM tasks. */
export const SAKANA_SIMPLE_MODEL = 'sakana/fugu';

/** Default Sakana model for customer-facing agent conversations. */
export const SAKANA_CONVERSATION_MODEL = 'sakana/fugu-ultra-20260615';

/** Default OpenAI-compatible base URL for Sakana's API. */
export const SAKANA_DEFAULT_BASE_URL = 'https://api.sakana.ai/v1';

/**
 * Modelo de visão usado quando o pedido traz imagem (print de orçamento,
 * voucher) e a org usa chave própria (MiniMax). Os modelos de texto M1/M2 não
 * enxergam imagem. Sobrescreva com `LLM_VISION_MODEL`.
 */
export const DEFAULT_VISION_MODEL = 'MiniMax-M3';
