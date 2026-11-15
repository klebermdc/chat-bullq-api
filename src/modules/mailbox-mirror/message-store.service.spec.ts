import { MailboxContactRole } from '@prisma/client';
import { MAX_ATTACHMENT_BYTES, MessageStoreService } from './message-store.service';
import type { ParsedEmail } from './message-parser';

const MAILBOX = {
  id: 'mb1',
  organizationId: 'org1',
  address: 'reservas@orlandofastpass.com.br',
  ignoredDomains: [],
};

function parsed(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    messageId: '<m1@x>',
    inReplyTo: null,
    subject: 'Voucher',
    fromAddr: 'ana@gmail.com',
    fromName: 'Ana',
    toAddrs: ['reservas@orlandofastpass.com.br'],
    ccAddrs: ['colega@orlandofastpass.com.br'],
    sentAt: new Date('2026-11-01T10:00:00Z'),
    snippet: 'oi',
    textBody: 'oi',
    htmlBody: '<p>oi</p>',
    attachments: [],
    addresses: [
      { address: 'ana@gmail.com', role: MailboxContactRole.FROM },
      { address: 'reservas@orlandofastpass.com.br', role: MailboxContactRole.TO },
      { address: 'colega@orlandofastpass.com.br', role: MailboxContactRole.CC },
    ],
    ...overrides,
  };
}

function setup(existing: { id: string } | null = null) {
  const prisma = {
    mailboxMessage: {
      findUnique: jest.fn().mockResolvedValue(existing),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'c1', email: 'ana@gmail.com' }]),
  };
  const storage = { put: jest.fn().mockResolvedValue(undefined) };
  const service = new MessageStoreService(prisma as never, storage as never);
  return { prisma, storage, service };
}

describe('MessageStoreService.save', () => {
  it('grava a mensagem nova ligada só ao cliente (ignora a caixa e o domínio da casa)', async () => {
    const { prisma, service } = setup();

    const result = await service.save(MAILBOX, 10, parsed());

    expect(result).toBe('created');
    expect(prisma.$queryRaw.mock.calls[0][0].values).toEqual(['org1', ['ana@gmail.com']]);
    const data = prisma.mailboxMessage.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organizationId: 'org1',
      mailboxId: 'mb1',
      uid: 10n,
      messageId: '<m1@x>',
      htmlBody: '<p>oi</p>',
      hasAttachments: false,
    });
    expect(data.contacts.createMany.data).toEqual([{ contactId: 'c1', role: MailboxContactRole.FROM }]);
  });

  it('mensagem já gravada (re-sincronização) só atualiza o UID, sem duplicar', async () => {
    const { prisma, storage, service } = setup({ id: 'msg1' });

    const result = await service.save(MAILBOX, 99, parsed());

    expect(result).toBe('existing');
    expect(prisma.mailboxMessage.update).toHaveBeenCalledWith({ where: { id: 'msg1' }, data: { uid: 99n } });
    expect(prisma.mailboxMessage.create).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('guarda anexo no MinIO e só registra o nome do que passa de 15 MB', async () => {
    const { prisma, storage, service } = setup();
    const small = { position: 0, filename: 'voucher.pdf', contentType: 'application/pdf', size: 10, content: Buffer.from('pdf') };
    const big = { position: 1, filename: 'video.mp4', contentType: 'video/mp4', size: MAX_ATTACHMENT_BYTES + 1, content: Buffer.alloc(1) };

    await service.save(MAILBOX, 10, parsed({ attachments: [small, big] }));

    expect(storage.put).toHaveBeenCalledTimes(1);
    const [key, , type] = storage.put.mock.calls[0];
    expect(key).toMatch(/^email\/org1\/[\w-]+\/0$/);
    expect(type).toBe('application/pdf');
    const data = prisma.mailboxMessage.create.mock.calls[0][0].data;
    expect(data.hasAttachments).toBe(true);
    expect(data.attachments.createMany.data).toEqual([
      { position: 0, filename: 'voucher.pdf', contentType: 'application/pdf', size: 10, storageKey: key },
      { position: 1, filename: 'video.mp4', contentType: 'video/mp4', size: MAX_ATTACHMENT_BYTES + 1, storageKey: null },
    ]);
    expect(data.id).toBe(key.split('/')[2]);
  });

  it('corrida com outra gravação (P2002) conta como já existente', async () => {
    const { prisma, service } = setup();
    prisma.mailboxMessage.create.mockRejectedValue(Object.assign(new Error('dup'), { code: 'P2002' }));

    await expect(service.save(MAILBOX, 10, parsed())).resolves.toBe('existing');
  });
});
