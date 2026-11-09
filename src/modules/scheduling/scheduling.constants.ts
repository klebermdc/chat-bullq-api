/** Fila BullMQ que dispara mensagens agendadas no horário (via delay). */
export const SCHEDULED_DISPATCH_QUEUE = 'scheduled-dispatch';
export const SCHEDULED_DISPATCH_JOB = 'dispatch-scheduled-message';

/**
 * Intervalo mínimo entre toques do reengajamento automático. Com 1h a OFP
 * mandou o mesmo texto 4x seguidas para os mesmos clientes (09/11/2026).
 */
export const MIN_REENGAGE_RETRY_HOURS = 24;

/** Cron que varre conversas e classifica faixas de inatividade. */
export const INACTIVITY_WATCHDOG_QUEUE = 'inactivity-watchdog';
export const INACTIVITY_WATCHDOG_JOB = 'scan-inactivity';

/** Watchdog de silêncio da cadência: decide retomar/rearmar/cancelar após a pausa. */
export const CADENCE_SILENCE_QUEUE = 'cadence-silence';
export const CADENCE_SILENCE_JOB = 'check-cadence-silence';
/** Mesma fila: saída do reengajamento, um dia depois do último toque. */
export const CADENCE_EXIT_JOB = 'cadence-no-reply-exit';
