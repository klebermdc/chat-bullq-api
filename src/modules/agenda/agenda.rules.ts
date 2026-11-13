import {
  isWithinHours,
  localParts,
  type BusinessHoursConfig,
} from '../routing/availability/business-hours.util';

/**
 * Regras puras da agenda do vendedor (sem banco). Usadas pela API, pela tela
 * e pelas ferramentas da Aline (horários livres / agendar).
 *
 * Expediente: o do vendedor (`UserOrganization.workingHours`), senão o da org;
 * nenhum dos dois = 24h — mesma regra do SLA de resposta.
 */

export interface TimeSlot {
  startsAt: Date;
  durationMin: number;
}

export type AppointmentRefusal = 'PASSADO' | 'FORA_DO_EXPEDIENTE' | 'CONFLITO';

const MINUTE_MS = 60_000;
/** Passo para conferir que o compromisso inteiro cabe no expediente. */
const HOURS_CHECK_STEP_MIN = 5;
export const DEFAULT_SLOT_STEP_MIN = 30;
export const DEFAULT_HORIZON_DAYS = 7;

const endOf = (slot: TimeSlot) => slot.startsAt.getTime() + slot.durationMin * MINUTE_MS;

export function overlaps(a: TimeSlot, b: TimeSlot): boolean {
  return a.startsAt.getTime() < endOf(b) && b.startsAt.getTime() < endOf(a);
}

/** O compromisso inteiro (do início ao último minuto) cai dentro do expediente. */
function fitsHours(hours: BusinessHoursConfig | null, tz: string, slot: TimeSlot): boolean {
  if (!hours) return true;
  const start = slot.startsAt.getTime();
  const lastMinute = endOf(slot) - MINUTE_MS;
  for (let t = start; t < lastMinute; t += HOURS_CHECK_STEP_MIN * MINUTE_MS) {
    if (!isWithinHours(hours, tz, new Date(t))) return false;
  }
  return isWithinHours(hours, tz, new Date(lastMinute));
}

export interface CheckInput extends TimeSlot {
  hours: BusinessHoursConfig | null;
  tz: string;
  now: Date;
  /** Compromissos ativos do vendedor (MARCADO). */
  busy: TimeSlot[];
}

/** null = pode marcar; senão o motivo da recusa. */
export function checkNewAppointment(input: CheckInput): AppointmentRefusal | null {
  if (input.startsAt.getTime() <= input.now.getTime()) return 'PASSADO';
  if (!fitsHours(input.hours, input.tz, input)) return 'FORA_DO_EXPEDIENTE';
  if (input.busy.some((b) => overlaps(b, input))) return 'CONFLITO';
  return null;
}

export interface FreeSlotsInput {
  hours: BusinessHoursConfig | null;
  tz: string;
  now: Date;
  busy: TimeSlot[];
  durationMin: number;
  count: number;
  /** Antecedência mínima a partir de agora (ex.: 60 = nada antes de 1h). */
  minLeadMin: number;
  stepMin?: number;
  horizonDays?: number;
}

/** Primeiro horário >= `from` alinhado ao passo no relógio local (09:00, 09:30…). */
function firstAligned(from: Date, tz: string, stepMin: number): Date {
  const ceilMinute = Math.ceil(from.getTime() / MINUTE_MS) * MINUTE_MS;
  const { minutes } = localParts(new Date(ceilMinute), tz);
  const pad = (stepMin - (minutes % stepMin)) % stepMin;
  return new Date(ceilMinute + pad * MINUTE_MS);
}

/** Próximos `count` horários livres do vendedor, em ordem. */
export function freeSlots(input: FreeSlotsInput): Date[] {
  const step = input.stepMin ?? DEFAULT_SLOT_STEP_MIN;
  const horizonEnd = input.now.getTime() + (input.horizonDays ?? DEFAULT_HORIZON_DAYS) * 1440 * MINUTE_MS;
  const slots: Date[] = [];
  let candidate = firstAligned(new Date(input.now.getTime() + input.minLeadMin * MINUTE_MS), input.tz, step);
  while (slots.length < input.count && candidate.getTime() < horizonEnd) {
    const refusal = checkNewAppointment({
      hours: input.hours,
      tz: input.tz,
      now: input.now,
      busy: input.busy,
      startsAt: candidate,
      durationMin: input.durationMin,
    });
    if (!refusal) slots.push(candidate);
    candidate = new Date(candidate.getTime() + step * MINUTE_MS);
  }
  return slots;
}
