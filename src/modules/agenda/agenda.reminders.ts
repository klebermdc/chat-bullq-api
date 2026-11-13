/**
 * Lembretes da agenda (regras puras). O lembrete guarda o horário marcado e,
 * na hora de disparar, só entrega se o compromisso continua MARCADO no mesmo
 * horário — assim remarcar/cancelar não exige apagar tarefas da fila.
 */
export const AGENDA_REMINDER_QUEUE = 'agenda-reminders';
export const AGENDA_REMINDER_JOB = 'agenda-reminder';
export const REMINDER_BEFORE_MIN = 10;
/** Marcador nos dados da notificação (o tipo é SYSTEM: enum existente não ganha valor novo). */
export const AGENDA_NOTIFICATION_KIND = 'AGENDA_LEMBRETE';

export type ReminderStage = 'antes' | 'agora';

export interface ReminderJobData {
  appointmentId: string;
  organizationId: string;
  stage: ReminderStage;
  /** startsAt (epoch ms) quando o lembrete foi agendado. */
  startsAt: number;
}

export function reminderPlan(startsAt: Date, now: Date): { stage: ReminderStage; at: Date }[] {
  const plan: { stage: ReminderStage; at: Date }[] = [
    { stage: 'antes', at: new Date(startsAt.getTime() - REMINDER_BEFORE_MIN * 60_000) },
    { stage: 'agora', at: startsAt },
  ];
  return plan.filter((p) => p.at.getTime() > now.getTime());
}

export function reminderJobId(appointmentId: string, stage: ReminderStage, startsAt: Date): string {
  return `agenda-${appointmentId}-${stage}-${startsAt.getTime()}`;
}

export function shouldDeliver(
  scheduledStartsAt: number,
  current: { status: string; startsAt: Date } | null,
): boolean {
  return !!current && current.status === 'MARCADO' && current.startsAt.getTime() === scheduledStartsAt;
}

export function reminderText(
  stage: ReminderStage,
  ctx: { contactName: string | null; startsAt: Date; tz: string },
): { title: string; body: string } {
  const name = ctx.contactName?.trim() || 'cliente';
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone: ctx.tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(ctx.startsAt);
  return stage === 'antes'
    ? { title: `Retorno em ${REMINDER_BEFORE_MIN} min: ${name}`, body: `Ligar para ${name} às ${time}.` }
    : { title: `Hora do retorno: ${name}`, body: `Ligar para ${name} agora (${time}).` };
}
