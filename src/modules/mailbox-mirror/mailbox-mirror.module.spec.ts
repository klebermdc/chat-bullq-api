import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../database/prisma.service';
import { ChannelAccessService } from '../iam/channel-access/channel-access.service';
import { ErrorReporterService } from '../error-reporter/error-reporter.service';
import { StorageService } from '../storage/storage.service';
import { MailboxAccessService } from './mailbox-access.service';
import { MailboxAdminService } from './mailbox-admin.service';
import { ContactEmailsController, EmailsController, MailboxesController } from './mailbox-mirror.controller';
import { MailboxSyncCron } from './mailbox-sync.cron';
import { MAILBOX_SYNC_EVERY_MS, MAILBOX_SYNC_QUEUE, MailboxSyncProcessor } from './mailbox-sync.processor';
import { MailboxSyncService } from './mailbox-sync.service';
import { MessageStoreService } from './message-store.service';
import { ImapSessionFactory } from './imap-session';

/**
 * Monta os providers do módulo só com os globais (Prisma, Storage,
 * ErrorReporter, Config, ChannelAccess do OrgGuard) e a fila: se algum dia o módulo passar a precisar de
 * um módulo de domínio, este teste quebra antes de virar ciclo de DI em produção.
 */
describe('MailboxMirrorModule (DI)', () => {
  it('resolve tudo só com dependências globais e agenda a cada 5 min', async () => {
    const queue = { upsertJobScheduler: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      controllers: [ContactEmailsController, EmailsController, MailboxesController],
      providers: [
        ImapSessionFactory,
        MessageStoreService,
        MailboxSyncService,
        MailboxSyncProcessor,
        MailboxSyncCron,
        MailboxAccessService,
        MailboxAdminService,
        { provide: PrismaService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: ErrorReporterService, useValue: { report: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        // Global no app (usado pelo OrgGuard dos controllers).
        { provide: ChannelAccessService, useValue: {} },
        { provide: getQueueToken(MAILBOX_SYNC_QUEUE), useValue: queue },
      ],
    }).compile();

    await moduleRef.get(MailboxSyncCron).onModuleInit();

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'email-mailbox-sync-cron',
      { every: MAILBOX_SYNC_EVERY_MS },
      expect.objectContaining({ name: 'sync-mailboxes' }),
    );
  });

  it('falha ao agendar não derruba o boot', async () => {
    const queue = { upsertJobScheduler: jest.fn().mockRejectedValue(new Error('redis fora')) };
    const cron = new MailboxSyncCron(queue as never);
    await expect(cron.onModuleInit()).resolves.toBeUndefined();
  });
});
