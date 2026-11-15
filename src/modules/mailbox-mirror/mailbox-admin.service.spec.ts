import { NotFoundException } from '@nestjs/common';
import { MailboxAdminService } from './mailbox-admin.service';
import { parsePage } from './pagination';

function setup() {
  const prisma = {
    mailbox: { findMany: jest.fn(), findFirst: jest.fn() },
    mailboxMessage: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  };
  return { prisma, service: new MailboxAdminService(prisma as never) };
}

describe('MailboxAdminService', () => {
  it('status das caixas converte o BigInt do cursor e não expõe senha (só o nome da variável)', async () => {
    const { prisma, service } = setup();
    prisma.mailbox.findMany.mockResolvedValue([
      { id: 'mb1', address: 'r@x', lastUid: 123n, passwordEnv: 'MAILBOX_R_PASSWORD', _count: { messages: 7 } },
    ]);

    const [row] = await service.listMailboxes('org1');

    expect(row).toEqual({ id: 'mb1', address: 'r@x', lastUid: '123', passwordEnv: 'MAILBOX_R_PASSWORD', messageCount: 7 });
    expect(prisma.mailbox.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org1' });
  });

  it('filtro "sem cliente" pede e-mails sem nenhum contato ligado', async () => {
    const { prisma, service } = setup();
    prisma.mailbox.findFirst.mockResolvedValue({ id: 'mb1' });

    await service.listMailboxEmails('org1', 'mb1', true, parsePage());

    expect(prisma.mailboxMessage.count).toHaveBeenCalledWith({
      where: { organizationId: 'org1', mailboxId: 'mb1', contacts: { none: {} } },
    });
  });

  it('caixa de outra org: 404', async () => {
    const { prisma, service } = setup();
    prisma.mailbox.findFirst.mockResolvedValue(null);

    await expect(service.listMailboxEmails('org1', 'mbX', false, parsePage())).rejects.toBeInstanceOf(NotFoundException);
  });
});
