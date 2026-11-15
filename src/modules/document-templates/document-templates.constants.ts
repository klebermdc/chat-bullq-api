/**
 * Teto por IP do "Preencher com IA": cada chamada é uma ida paga ao LLM com
 * até ~24k caracteres de conversa. Folgado para atendente, apertado p/ script.
 */
export const LIMITE_IA = { ttl: 60_000, limit: 10 };
