import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { NotificationType } from '@prisma/client';
import type { Job } from 'bullmq';
import { NotificationsService } from '../notifications/notifications.service';
import { AgendaRepository } from './agenda.repository';
import {
  AGENDA_NOTIFICATION_KIND,
  AGENDA_REMINDER_QUEUE,
  reminderText,
  shouldDeliver,
  type ReminderJobData,
} from './agenda.reminders';

const SYSTEM: NotificationType = 'SYSTEM';

/** Entrega o lembrete ao vendedor se o compromisso continua marcado no mesmo horário. */
@Processor(AGENDA_REMINDER_QUEUE, { concurrency: 4 })
export class AgendaReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(AgendaReminderProcessor.name);

  constructor(
    private readonly repo: AgendaRepository,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  async process(job: Job<ReminderJobData>): Promise<{ delivered: boolean }> {
    const { appointmentId, organizationId, stage, startsAt } = job.data;
    const appt = await this.repo.findForReminder(organizationId, appointmentId);
    if (!shouldDeliver(startsAt, appt)) return { delivered: false };
    const { tz } = await this.repo.ownerSchedule(organizationId, appt!.ownerUserId);
    const text = reminderText(stage, { contactName: appt!.contact?.name ?? null, startsAt: appt!.startsAt, tz });
    await this.notifications.notify({
      recipientId: appt!.ownerUserId,
      organizationId,
      type: SYSTEM,
      title: text.title,
      body: text.body,
      data: {
        kind: AGENDA_NOTIFICATION_KIND,
        stage,
        appointmentId,
        conversationId: appt!.conversationId,
        contactId: appt!.contactId,
      },
    });
    this.logger.log(`Lembrete ${stage} do compromisso ${appointmentId} entregue`);
    return { delivered: true };
  }
}
