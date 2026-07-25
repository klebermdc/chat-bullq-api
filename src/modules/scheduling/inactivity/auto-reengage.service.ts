import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ScheduledMessagesRepository } from '../scheduled-messages.repository';
import { InactivityRepository } from './inactivity.repository';
import { ReengageDraftService } from './reengage-draft.service';
import { SCHEDULED_DISPATCH_QUEUE, SCHEDULED_DISPATCH_JOB } from '../scheduling.constants';
import { nextAllowedTime } from './quiet-hours.util';
import type { ResolvedInactivitySettings } from './inactivity-settings.service';

@Injectable()
export class AutoReengageService {
  private readonly logger = new Logger(AutoReengageService.name);

  constructor(
    private readonly schedRepo: ScheduledMessagesRepository,
    private readonly inactivityRepo: InactivityRepository,
    private readonly draftService: ReengageDraftService,
    @InjectQueue(SCHEDULED_DISPATCH_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Cria um ScheduledMessage AUTO_REENGAGE se ainda não há pendente para a
   * conversa e a sugestão não foi descartada. Respeita quiet hours agendando
   * para o próximo horário permitido.
   *
   * O objeto `conv` vem do `scanCandidates` (watchdog), que já traz
   * `contactId`/`channelId` — evitando queries extras aqui.
   */
  async maybeCreate(
    organizationId: string,
    conv: {
      id: string;
      assignedToId: string | null;
      reengageDismissedAt: Date | null;
      reengagedAt: Date | null;
      contactId: string;
      channelId: string;
    },
    band: number,
    cfg: ResolvedInactivitySettings,
  ): Promise<void> {
    if (conv.reengageDismissedAt) return;
    // Já disparamos um burst nesta streak de silêncio; só volta a valer quando
    // o cliente responder (inbound limpa `reengagedAt`).
    if (conv.reengagedAt) return;

    const pending = await this.schedRepo.findPending(conv.id);
    if (pending.length > 0) return; // já tem agendamento

    const senderId = await this.inactivityRepo.resolveSystemSender(
      organizationId,
      conv.assignedToId,
    );
    if (!senderId) return;

    const draft = await this.draftService.draft(organizationId, conv.id);
    if (!draft) return; // sem rascunho, não auto-dispara

    const timeZone = await this.inactivityRepo.orgTimezone(organizationId);
    const scheduledAt = this.nextAllowedTime(
      new Date(),
      cfg.quietHoursStart,
      cfg.quietHoursEnd,
      timeZone,
    );

    const created = await this.schedRepo.create({
      organizationId,
      conversationId: conv.id,
      contactId: conv.contactId,
      channelId: conv.channelId,
      createdById: senderId,
      origin: 'AUTO_REENGAGE',
      contentType: 'TEXT',
      content: { text: draft },
      scheduledAt,
      maxAttempts: cfg.maxAttempts,
      attempt: 1,
      retryEveryHours: cfg.retryEveryHours,
      requireAiParked: cfg.reengageOnlyAiParked,
    });

    const job = await this.queue.add(
      SCHEDULED_DISPATCH_JOB,
      { scheduledMessageId: created.id },
      {
        delay: Math.max(0, scheduledAt.getTime() - Date.now()),
        jobId: `sched-${created.id}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
    await this.schedRepo.update(created.id, { jobId: String(job.id) });

    // Marca a conversa para não re-disparar até o cliente responder.
    await this.inactivityRepo.markReengaged(conv.id);

    this.logger.log(
      `auto_reengage_created conv=${conv.id} band=${band} at=${scheduledAt.toISOString()}`,
    );
  }

  /**
   * Delega ao util puro `quiet-hours.util`. Mantido como método para não
   * quebrar os callers (e os specs) que já dependem desta assinatura.
   */
  nextAllowedTime(
    now: Date,
    startHour: number | null,
    endHour: number | null,
    timeZone: string,
  ): Date {
    return nextAllowedTime(now, startHour, endHour, timeZone);
  }
}
