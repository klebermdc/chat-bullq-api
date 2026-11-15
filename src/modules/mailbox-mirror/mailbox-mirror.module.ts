import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ImapSessionFactory } from './imap-session';
import { MailboxAccessService } from './mailbox-access.service';
import { MailboxAdminService } from './mailbox-admin.service';
import { ContactEmailsController, EmailsController, MailboxesController } from './mailbox-mirror.controller';
import { MailboxSyncCron } from './mailbox-sync.cron';
import { MAILBOX_SYNC_QUEUE, MailboxSyncProcessor } from './mailbox-sync.processor';
import { MailboxSyncService } from './mailbox-sync.service';
import { MessageStoreService } from './message-store.service';

/**
 * Espelho só leitura da caixa reservas@ (IMAP) — docs/plans/email-reservas.md.
 * Só depende de Prisma, Storage, ErrorReporter e Config (todos globais) e
 * não importa nenhum módulo de domínio: sem risco de ciclo de DI.
 */
@Module({
  imports: [BullModule.registerQueue({ name: MAILBOX_SYNC_QUEUE })],
  controllers: [ContactEmailsController, EmailsController, MailboxesController],
  providers: [
    ImapSessionFactory,
    MessageStoreService,
    MailboxSyncService,
    MailboxSyncProcessor,
    MailboxSyncCron,
    MailboxAccessService,
    MailboxAdminService,
  ],
})
export class MailboxMirrorModule {}
