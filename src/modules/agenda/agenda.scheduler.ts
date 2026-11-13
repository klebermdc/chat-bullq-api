import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  AGENDA_REMINDER_JOB,
  AGENDA_REMINDER_QUEUE,
  reminderJobId,
  reminderPlan,
  type ReminderJobData,
} from './agenda.reminders';

const KEEP_FINISHED_JOBS = { age: 7 * 24 * 3600, count: 1000 };

/** Põe na fila os lembretes de um compromisso (10 min antes e na hora). */
@Injectable()
export class AgendaReminderScheduler {
  private readonly logger = new Logger(AgendaReminderScheduler.name);

  constructor(@InjectQueue(AGENDA_REMINDER_QUEUE) private readonly queue: Queue) {}

  async schedule(appt: { id: string; organizationId: string; startsAt: Date }, now: Date = new Date()): Promise<void> {
    for (const { stage, at } of reminderPlan(appt.startsAt, now)) {
      const data: ReminderJobData = {
        appointmentId: appt.id,
        organizationId: appt.organizationId,
        stage,
        startsAt: appt.startsAt.getTime(),
      };
      try {
        await this.queue.add(AGENDA_REMINDER_JOB, data, {
          jobId: reminderJobId(appt.id, stage, appt.startsAt),
          delay: Math.max(0, at.getTime() - now.getTime()),
          removeOnComplete: KEEP_FINISHED_JOBS,
          removeOnFail: KEEP_FINISHED_JOBS,
        });
      } catch (err) {
        // Falha na fila não pode impedir o compromisso de ser marcado.
        this.logger.error(`Não agendei lembrete ${stage} de ${appt.id}: ${(err as Error).message}`);
      }
    }
  }
}
