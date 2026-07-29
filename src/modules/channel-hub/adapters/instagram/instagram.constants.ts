/** Fila BullMQ que renova os tokens de 60 dias do Instagram. */
export const IG_TOKEN_REFRESH_QUEUE = 'instagram-token-refresh';
export const IG_TOKEN_REFRESH_JOB = 'refresh-instagram-tokens';

/**
 * Escopos pedidos no OAuth. `manage_comments` não é usado nesta fatia, mas entra
 * na mesma submissão de App Review pra não precisar de uma segunda rodada quando
 * a Fatia 2 (comentário→DM) chegar.
 */
export const IG_OAUTH_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_messages',
  'instagram_business_manage_comments',
].join(',');

/** Campos de webhook assinados no /subscribed_apps. */
export const IG_SUBSCRIBED_FIELDS = 'messages,messaging_postbacks,messaging_seen';
