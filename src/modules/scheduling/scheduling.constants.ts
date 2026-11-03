/** Fila BullMQ que dispara mensagens agendadas no horário (via delay). */
export const SCHEDULED_DISPATCH_QUEUE = 'scheduled-dispatch';
export const SCHEDULED_DISPATCH_JOB = 'dispatch-scheduled-message';

/** Cron que varre conversas e classifica faixas de inatividade. */
export const INACTIVITY_WATCHDOG_QUEUE = 'inactivity-watchdog';
export const INACTIVITY_WATCHDOG_JOB = 'scan-inactivity';

/** Watchdog de silêncio da cadência: decide retomar/rearmar/cancelar após a pausa. */
export const CADENCE_SILENCE_QUEUE = 'cadence-silence';
export const CADENCE_SILENCE_JOB = 'check-cadence-silence';
/** Mesma fila: saída do reengajamento, um dia depois do último toque. */
export const CADENCE_EXIT_JOB = 'cadence-no-reply-exit';
