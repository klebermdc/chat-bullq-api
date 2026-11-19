import type { RecipientResult } from '../response-sla/manager-alerts/manager-alerts.sender';
import type { PulseKind } from './team-pulse.rules';

export const TEAM_PULSE_QUEUE = 'team-pulse';
export const TEAM_PULSE_TICK_JOB = 'team-pulse-tick';
/** Minuto 0 de toda hora; a decisão (pulso, fechamento ou nada) fica no serviço. */
export const TEAM_PULSE_PATTERN = '0 * * * *';
/** Injeção da trava (Redis da própria fila). */
export const TEAM_PULSE_THROTTLE = 'TEAM_PULSE_THROTTLE';

export interface TeamPulseSendReport {
  kind: PulseKind;
  template: string;
  results: RecipientResult[];
}
