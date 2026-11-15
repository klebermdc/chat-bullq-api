import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { MAILBOX_SYNC_EVERY_MS, MAILBOX_SYNC_JOB, MAILBOX_SYNC_QUEUE } from './mailbox-sync.processor';

/** Registra a sincronização a cada 5 min no boot (mesmo padrão do AutoCloseCron). */
@Injectable()
export class MailboxSyncCron implements OnModuleInit {
  private readonly logger = new Logger(MailboxSyncCron.name);

  constructor(@InjectQueue(MAILBOX_SYNC_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        'email-mailbox-sync-cron',
        { every: MAILBOX_SYNC_EVERY_MS },
        {
          name: MAILBOX_SYNC_JOB,
          data: {},
          // Sem retry: a próxima rodada já é daqui a 5 min.
          opts: { removeOnComplete: 10, removeOnFail: 10, attempts: 1 },
        },
      );
      this.logger.log(`espelho de e-mail agendado a cada ${MAILBOX_SYNC_EVERY_MS / 60_000} min`);
    } catch (err) {
      // Falhar aqui não pode impedir o boot da API.
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`falha ao agendar espelho de e-mail: ${msg}`);
    }
  }
}
