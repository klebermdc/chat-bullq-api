/** Fila BullMQ que dispara mensagens agendadas no horário (via delay). */
export const SCHEDULED_DISPATCH_QUEUE = 'scheduled-dispatch';
export const SCHEDULED_DISPATCH_JOB = 'dispatch-scheduled-message';

/** Cron que varre conversas e classifica faixas de inatividade. */
export const INACTIVITY_WATCHDOG_QUEUE = 'inactivity-watchdog';
export const INACTIVITY_WATCHDOG_JOB = 'scan-inactivity';
