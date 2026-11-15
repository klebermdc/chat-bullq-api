import { ErrorSource } from '@prisma/client';
import { ERROR_CODES } from '../error-reporter/error-codes';
import { MailboxSyncProcessor } from './mailbox-sync.processor';

function setup(mailboxes: unknown[] | Error) {
  const prisma = {
    mailbox: {
      findMany: mailboxes instanceof Error ? jest.fn().mockRejectedValue(mailboxes) : jest.fn().mockResolvedValue(mailboxes),
    },
  };
  const sync = { syncMailbox: jest.fn() };
  const errors = { report: jest.fn() };
  const processor = new MailboxSyncProcessor(prisma as never, sync as never, errors as never);
  return { prisma, sync, errors, processor };
}

describe('MailboxSyncProcessor', () => {
  it('só pega caixas ligadas e conta o resultado de cada uma', async () => {
    const { prisma, sync, processor } = setup([{ id: 'a' }, { id: 'b' }]);
    sync.syncMailbox
      .mockResolvedValueOnce({ status: 'synced', created: 1, existing: 0, lastUid: 1n })
      .mockResolvedValueOnce({ status: 'skipped', reason: 'sem senha' });

    expect(await processor.process()).toEqual({ synced: 1, skipped: 1, failed: 0 });
    expect(prisma.mailbox.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { enabled: true } }));
  });

  it('uma caixa com erro é reportada e não impede as outras', async () => {
    const { sync, errors, processor } = setup([
      { id: 'a', organizationId: 'org1' },
      { id: 'b', organizationId: 'org1' },
    ]);
    sync.syncMailbox
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ status: 'synced', created: 0, existing: 0, lastUid: 0n });

    expect(await processor.process()).toEqual({ synced: 1, skipped: 0, failed: 1 });
    expect(errors.report).toHaveBeenCalledWith(
      expect.objectContaining({
        source: ErrorSource.JOB,
        code: ERROR_CODES.MAILBOX_SYNC_FAILED,
        organizationId: 'org1',
        context: expect.objectContaining({ mailboxId: 'a' }),
      }),
    );
  });

  it('reporta e relança quando nem a lista de caixas carrega', async () => {
    const { errors, processor } = setup(new Error('db down'));

    await expect(processor.process()).rejects.toThrow('db down');
    expect(errors.report).toHaveBeenCalledWith(expect.objectContaining({ source: ErrorSource.JOB }));
  });
});
