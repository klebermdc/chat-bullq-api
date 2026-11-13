export const MYSTERY_SHOPPER_QUEUE = 'mystery-shopper';
export const SWEEP_JOB = 'sweep';
export const EVALUATE_JOB = 'evaluate';
export const SWEEP_SCHEDULER_ID = 'mystery-shopper-sweep';
export const SWEEP_PATTERN = '*/15 * * * *';
export const SWEEP_TIMEZONE = 'America/Sao_Paulo';
export const KEEP_FINISHED_JOBS = 10;

/** Espera depois da última mensagem do cliente oculto, para medir o follow-up. */
export const FOLLOW_UP_WINDOW_HOURS = 72;
/** Resposta mais rápida que isso ainda é continuação da conversa, não follow-up. */
export const FOLLOW_UP_MIN_GAP_HOURS = 2;

/** Categoria das skills que são critério do cliente oculto. */
export const MYSTERY_SKILL_CATEGORY = 'cliente-oculto';
/** Regras de produto já escritas para o Diário: reaproveitadas aqui. */
export const DIARY_SKILL_CATEGORY = 'diario-atendente';
export const PRODUCT_RULES_SKILL = 'diarioRegrasProduto';

/** Critérios medidos por código (nomes fixos). */
export const FIRST_REPLY_CRITERION = 'primeiraResposta';
export const FOLLOW_UP_CRITERION = 'ocultoFollowUp';
/** Único critério que pode ser "não se aplica" (nota null). */
export const OBJECTION_CRITERION = 'ocultoObjecao';
export const FIRST_REPLY_GOOD_MINUTES = 15;
export const FIRST_REPLY_OK_MINUTES = 60;

export const MAX_SCORE_PER_CRITERION = 2;
export const MAX_TRANSCRIPT_LINES = 300;
export const MAX_LINE_CHARS = 1000;
export const MIN_QUOTE_CHARS = 10;
export const EVALUATION_MAX_TOKENS = 4000;
export const MAX_EVALUATION_ATTEMPTS = 2;
export const MAX_SUMMARY_POINTS = 2;

export const RANKING_DAYS = 90;
/** Até este número de visitas o ranking avisa "amostra pequena". */
export const SMALL_SAMPLE_VISITS = 2;
export const VISIT_LIST_LIMIT = 200;

export const NON_CONVERSATIONAL_TYPES = ['REACTION', 'SYSTEM'] as const;

/** Mesmo id por visita: dois cliques não pagam a IA duas vezes. */
export function evaluateJobOptions(visitId: string) {
  return { jobId: `mystery-eval-${visitId}`, removeOnComplete: true, removeOnFail: true };
}
