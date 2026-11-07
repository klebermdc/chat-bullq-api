import type { RecipientResult } from './manager-alerts.sender';

export const MANAGER_ALERTS_QUEUE = 'sla-manager-alerts';
export const MANAGER_ALERTS_TICK_JOB = 'sla-manager-alerts-tick';
/** Resumo checado a cada 5 min; o placar usa o mesmo tique. */
export const MANAGER_ALERTS_PATTERN = '*/5 * * * *';
/** Injeção da trava (Redis da própria fila). */
export const MANAGER_ALERTS_THROTTLE = 'MANAGER_ALERTS_THROTTLE';

export type ManagerAlertKind = 'digest' | 'scoreboard';
export const MANAGER_ALERT_KINDS: ReadonlyArray<ManagerAlertKind> = ['digest', 'scoreboard'];

export interface ManagerAlertSendReport {
  kind: ManagerAlertKind;
  template: string;
  /** Resumo: esperas acima do corte. Placar: esperas que contaram no dia. */
  count: number;
  results: RecipientResult[];
}
