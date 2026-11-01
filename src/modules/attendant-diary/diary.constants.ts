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

/** Limites por diário: mantêm o custo previsível e a leitura curta. */
export const MAX_CONVERSATIONS_PER_DIARY = 12;
export const MAX_LINES_PER_CONVERSATION = 40;
export const MAX_CONTEXT_MESSAGES = 10;
export const MAX_LINE_CHARS = 600;
export const MAX_POINTS_PER_SECTION = 2;
export const MIN_QUOTE_CHARS = 15;
export const DIARY_MAX_TOKENS = 2000;

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
