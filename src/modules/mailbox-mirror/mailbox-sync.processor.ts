import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ErrorSeverity, ErrorSource } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ERROR_CODES } from '../error-reporter/error-codes';
import { ErrorReporterService } from '../error-reporter/error-reporter.service';
import { MailboxSyncService } from './mailbox-sync.service';

export const MAILBOX_SYNC_QUEUE = 'email-mailbox-sync';
export const MAILBOX_SYNC_JOB = 'sync-mailboxes';
export const MAILBOX_SYNC_EVERY_MS = 5 * 60 * 1000;

export interface MailboxSyncSummary {
  synced: number;
  skipped: number;
  failed: number;
}

@Processor(MAILBOX_SYNC_QUEUE, { concurrency: 1 })
export class MailboxSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(MailboxSyncProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: MailboxSyncService,
    private readonly errors: ErrorReporterService,
  ) {
    super();
  }

  /**
   * Passa por todas as caixas ligadas. Uma caixa com problema não segura as
   * outras: o erro vai para `lastError` + painel de erros, e a próxima rodada
   * (5 min) é a nova tentativa. Só relança se nem a lista de caixas carregou.
   */
  async process(): Promise<MailboxSyncSummary> {
    const mailboxes = await this.loadMailboxes();
    const summary = { synced: 0, skipped: 0, failed: 0 };
    for (const mailbox of mailboxes) {
      try {
        const outcome = await this.sync.syncMailbox(mailbox);
        summary[outcome.status === 'synced' ? 'synced' : 'skipped'] += 1;
      } catch (err) {
        summary.failed += 1;
        this.report(err, { mailboxId: mailbox.id }, mailbox.organizationId);
      }
    }
    return summary;
  }

  private async loadMailboxes() {
    try {
      return await this.prisma.mailbox.findMany({ where: { enabled: true }, orderBy: { createdAt: 'asc' } });
    } catch (err) {
      this.report(err, {});
      throw err;
    }
  }

  private report(err: unknown, context: Record<string, unknown>, organizationId?: string): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.error(`sincronização de e-mail falhou: ${msg}`);
    this.errors.report({
      source: ErrorSource.JOB,
      code: ERROR_CODES.MAILBOX_SYNC_FAILED,
      severity: ErrorSeverity.ERROR,
      message: `Espelho da caixa de e-mail falhou: ${msg}`,
      stack: err instanceof Error ? err.stack : undefined,
      context: { job: MAILBOX_SYNC_QUEUE, ...context },
      organizationId,
    });
  }
}
