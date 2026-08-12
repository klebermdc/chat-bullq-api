/** Fila que executa o sync de UMA conexão. */
export const MARKETING_SYNC_QUEUE = 'marketing-sync';
export const MARKETING_SYNC_JOB = 'marketing-sync';

/** Fila do tick diário, que só enfileira jobs na fila acima. */
export const MARKETING_SYNC_CRON_QUEUE = 'marketing-sync-cron';
export const MARKETING_SYNC_CRON_JOB = 'marketing-sync-cron';

/** 05:10 todo dia. Depois da virada de dia no fuso do ad account. */
export const MARKETING_SYNC_CRON_PATTERN = '10 5 * * *';

/**
 * A Meta revisa insights retroativamente. O sync diário reprocessa sempre
 * esta janela, e o upsert na chave única garante que reprocessar não duplica.
 */
export const MARKETING_SYNC_WINDOW_DAYS = 7;

/** Quantos dias para trás o backfill varre quando a conta é conectada. */
export const MARKETING_BACKFILL_DAYS = 90;

/** Backfill vai em blocos para não estourar o limite de uma resposta. */
export const MARKETING_BACKFILL_CHUNK_DAYS = 30;

export const GRAPH_API_VERSION = 'v21.0';
export const INSIGHTS_PAGE_LIMIT = 500;
export const GRAPH_TIMEOUT_MS = 60000;

/** Escopos pedidos no Facebook Login for Business. */
export const META_ADS_SCOPES = ['ads_read', 'business_management'];
