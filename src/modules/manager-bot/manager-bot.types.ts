export const MANAGER_BOT_QUEUE = 'manager-bot';
export const MANAGER_BOT_TICK_JOB = 'manager-bot-tick';
/** Relatórios e alertas checados a cada 5 min. */
export const MANAGER_BOT_PATTERN = '*/5 * * * *';
/** Injeção da trava (Redis da própria fila). */
export const MANAGER_BOT_THROTTLE = 'MANAGER_BOT_THROTTLE';

export type ManagerReportKind = 'opening' | 'closing' | 'weekly' | 'costs';
export const MANAGER_REPORT_KINDS: ReadonlyArray<ManagerReportKind> = ['opening', 'closing', 'weekly', 'costs'];

export interface BroadcastResult {
  chatId: string;
  ok: boolean;
  error?: string;
}
