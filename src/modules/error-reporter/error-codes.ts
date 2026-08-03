/**
 * Catálogo dos códigos de erro. O `code` entra no fingerprint, então mudar
 * uma string aqui quebra o agrupamento histórico daquele problema — trate
 * como identificador estável, não como texto de UI.
 */
export const ERROR_CODES = {
  // source: API
  UNHANDLED_HTTP: 'UNHANDLED_HTTP',

  // source: CHANNEL
  WEBHOOK_UNSUPPORTED_TYPE: 'WEBHOOK_UNSUPPORTED_TYPE',
  WEBHOOK_NO_LOCATORS: 'WEBHOOK_NO_LOCATORS',
  WEBHOOK_UNROUTED: 'WEBHOOK_UNROUTED',
  // Distinto do UNROUTED de propósito: aqui o canal EXISTE e só está
  // desativado, então o conserto é reativá-lo — não investigar configuração.
  WEBHOOK_CHANNEL_INACTIVE: 'WEBHOOK_CHANNEL_INACTIVE',
  WEBHOOK_INVALID_SIGNATURE: 'WEBHOOK_INVALID_SIGNATURE',

  // source: AI
  AI_RUN_FAILED: 'AI_RUN_FAILED',

  // source: JOB
  JOB_FAILED: 'JOB_FAILED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
