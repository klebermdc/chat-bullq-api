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

/**
 * Tolerância do farol, relativa ao próprio alvo. Verde = melhor ou igual ao
 * alvo. Amarelo = pior, mas dentro da tolerância. Vermelho = além dela.
 *
 * Substitui os dez pares de limites cravados no código do ofphub por uma
 * regra só.
 */
export const GOAL_TOLERANCE_PCT = 50;

/**
 * Budget pace não usa a regra acima: é vermelho quando o percentual gasto
 * supera o percentual do mês decorrido em mais que estes pontos percentuais.
 */
export const BUDGET_PACE_TOLERANCE_PP = 10;
