import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ScheduledMessagesRepository } from '../scheduled-messages.repository';
import { InactivityRepository } from './inactivity.repository';
import { ReengageDraftService } from './reengage-draft.service';
import { SCHEDULED_DISPATCH_QUEUE, SCHEDULED_DISPATCH_JOB } from '../scheduling.constants';
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
      contactId: string;
      channelId: string;
    },
    band: number,
    cfg: ResolvedInactivitySettings,
  ): Promise<void> {
    if (conv.reengageDismissedAt) return;

    const pending = await this.schedRepo.findPending(conv.id);
    if (pending.length > 0) return; // já tem agendamento

    const senderId = await this.inactivityRepo.resolveSystemSender(
      organizationId,
      conv.assignedToId,
    );
    if (!senderId) return;

    const draft = await this.draftService.draft(organizationId, conv.id);
    if (!draft) return; // sem rascunho, não auto-dispara

    const scheduledAt = this.nextAllowedTime(new Date(), cfg.quietHoursStart, cfg.quietHoursEnd);

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
    });

    const job = await this.queue.add(
      SCHEDULED_DISPATCH_JOB,
      { scheduledMessageId: created.id },
      {
        delay: Math.max(0, scheduledAt.getTime() - Date.now()),
        jobId: `sched:${created.id}`,
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
    await this.schedRepo.update(created.id, { jobId: String(job.id) });

    this.logger.log(
      `auto_reengage_created conv=${conv.id} band=${band} at=${scheduledAt.toISOString()}`,
    );
  }

  /** Se estamos dentro do quiet window, empurra para o quietHoursEnd; senão agora. */
  nextAllowedTime(now: Date, startHour: number | null, endHour: number | null): Date {
    if (startHour === null || endHour === null) return now;
    const h = now.getHours();
    const inQuiet =
      startHour <= endHour ? h >= startHour && h < endHour : h >= startHour || h < endHour;
    if (!inQuiet) return now;
    const next = new Date(now);
    next.setHours(endHour, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next;
  }
}
