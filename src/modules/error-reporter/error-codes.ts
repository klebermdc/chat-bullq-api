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
  WEBHOOK_INVALID_SIGNATURE: 'WEBHOOK_INVALID_SIGNATURE',

  // source: AI
  AI_RUN_FAILED: 'AI_RUN_FAILED',

  // source: JOB
  JOB_FAILED: 'JOB_FAILED',

  // source: JOB — marketing
  MARKETING_SYNC_FAILED: 'MARKETING_SYNC_FAILED',
  MARKETING_TOKEN_INVALID: 'MARKETING_TOKEN_INVALID',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
