export const DIARY_QUEUE = 'attendant-diary';
export const DIARY_DAILY_JOB = 'daily-run';
export const DIARY_GENERATE_JOB = 'generate';

/** Categoria das skills que servem de critério do diário. */
export const DIARY_SKILL_CATEGORY = 'diario-atendente';

export const KEEP_FINISHED_JOBS = 20;

/** Tipos que não são fala de ninguém: não contam em métrica nem na avaliação. */
export const NON_CONVERSATIONAL_TYPES = ['REACTION', 'SYSTEM'] as const;

export const DEFAULT_DIARY_CRON = '0 6 * * *';
export const DEFAULT_DIARY_TIMEZONE = 'America/Sao_Paulo';

/** Resposta acima disso (em horário de trabalho) conta como demorada. */
export const SLOW_REPLY_MINUTES = 30;

/** O dia inteiro é avaliado; estes tetos só protegem contra um dia anormal. */
export const MAX_CONVERSATIONS_PER_DIARY = 100;
export const MAX_LINES_PER_CONVERSATION = 200;
/** Conversas por chamada à IA: dias maiores são avaliados em blocos. */
export const DIARY_BATCH_SIZE = 10;
export const MAX_CONTEXT_MESSAGES = 10;
export const MAX_LINE_CHARS = 1000;
export const MAX_POINTS_PER_SECTION = 4;
export const MIN_QUOTE_CHARS = 15;
export const DIARY_MAX_TOKENS = 4000;
export const MIN_SCORE = 1;
export const MAX_SCORE = 5;
/** Primeira tentativa e uma nova, se a IA misturar outro idioma. */
export const MAX_EVALUATION_ATTEMPTS = 2;

/**
 * Mesmo id para o mesmo dia: dois cliques não pagam a IA duas vezes. O job é
 * apagado ao terminar para que gerar de novo depois continue possível.
 */
export function diaryJobOptions(organizationId: string, userId: string, day: string) {
  return {
    jobId: `diary-${organizationId}-${userId}-${day}`,
    removeOnComplete: true,
    removeOnFail: true,
  };
}
