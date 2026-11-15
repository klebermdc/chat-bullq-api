import { NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { MailboxAccessService, reachableContactWhere, visibleEmailWhere } from './mailbox-access.service';
import { parsePage } from './pagination';

const AGENT = { organizationId: 'org1', role: OrgRole.AGENT, userId: 'u1' };
const ADMIN = { organizationId: 'org1', role: OrgRole.ADMIN, userId: 'u9' };

const AGENT_CONVERSATIONS = {
  some: { OR: [{ assignedToId: 'u1' }, { participants: { some: { userId: 'u1' } } }] },
};

function setup() {
  const prisma = {
    contact: { findFirst: jest.fn() },
    mailboxMessage: {
      findMany: jest.fn().mockResolvedValue([{ id: 'e1' }]),
      count: jest.fn().mockResolvedValue(1),
      findFirst: jest.fn(),
    },
    mailboxAttachment: { findFirst: jest.fn() },
  };
  return { prisma, service: new MailboxAccessService(prisma as never) };
}

describe('regras de escopo', () => {
  it('AGENT só alcança contato com conversa dele (dono ou incluído)', () => {
    expect(reachableContactWhere(AGENT)).toEqual({
      organizationId: 'org1',
      deletedAt: null,
      conversations: AGENT_CONVERSATIONS,
    });
  });

  it('ADMIN e OWNER alcançam qualquer contato da org', () => {
    expect(reachableContactWhere(ADMIN)).toEqual({ organizationId: 'org1', deletedAt: null });
    expect(reachableContactWhere({ ...ADMIN, role: OrgRole.OWNER })).not.toHaveProperty('conversations');
  });

  it('sem role (falha no guard) trata como AGENT: fail-closed', () => {
    expect(reachableContactWhere({ ...AGENT, role: undefined })).toHaveProperty('conversations');
  });

  it('e-mail para AGENT exige contato ligado que ele alcança; ADMIN só a org', () => {
    expect(visibleEmailWhere(AGENT, 'e1')).toEqual({
      id: 'e1',
      organizationId: 'org1',
      contacts: { some: { contact: reachableContactWhere(AGENT) } },
    });
    expect(visibleEmailWhere(ADMIN, 'e1')).toEqual({ id: 'e1', organizationId: 'org1' });
  });
});

describe('MailboxAccessService', () => {
  it('lista e-mails do contato quando o AGENT o alcança', async () => {
    const { prisma, service } = setup();
    prisma.contact.findFirst.mockResolvedValue({ id: 'c1' });

    const result = await service.listContactEmails(AGENT, 'c1', parsePage('1', '20'));

    expect(prisma.contact.findFirst.mock.calls[0][0].where).toEqual({
      id: 'c1',
      ...reachableContactWhere(AGENT),
    });
    expect(prisma.mailboxMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org1', contacts: { some: { contactId: 'c1' } } } }),
    );
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('contato de outro vendedor: 404, sem consultar os e-mails', async () => {
    const { prisma, service } = setup();
    prisma.contact.findFirst.mockResolvedValue(null);

    await expect(service.listContactEmails(AGENT, 'c2', parsePage())).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.mailboxMessage.findMany).not.toHaveBeenCalled();
  });

  it('detalhe esconde a chave do MinIO e filtra os contatos ligados pelo escopo', async () => {
    const { prisma, service } = setup();
    prisma.mailboxMessage.findFirst.mockResolvedValue({
      id: 'e1',
      attachments: [
        { id: 'a1', position: 0, filename: 'v.pdf', contentType: 'application/pdf', size: 3, storageKey: 'email/org1/e1/0' },
        { id: 'a2', position: 1, filename: 'big.mp4', contentType: 'video/mp4', size: 9e7, storageKey: null },
      ],
      contacts: [],
    });

    const email = await service.getEmail(AGENT, 'e1');

    const args = prisma.mailboxMessage.findFirst.mock.calls[0][0];
    expect(args.where).toEqual(visibleEmailWhere(AGENT, 'e1'));
    expect(args.select.contacts.where).toEqual({ contact: reachableContactWhere(AGENT) });
    expect(email.attachments).toEqual([
      { id: 'a1', position: 0, filename: 'v.pdf', contentType: 'application/pdf', size: 3, stored: true },
      { id: 'a2', position: 1, filename: 'big.mp4', contentType: 'video/mp4', size: 9e7, stored: false },
    ]);
  });

  it('detalhe fora do escopo: 404', async () => {
    const { prisma, service } = setup();
    prisma.mailboxMessage.findFirst.mockResolvedValue(null);

    await expect(service.getEmail(AGENT, 'e1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('anexo passa pela mesma barreira do e-mail e só serve chave da própria org', async () => {
    const { prisma, service } = setup();
    prisma.mailboxAttachment.findFirst.mockResolvedValue({
      filename: 'v.pdf', contentType: 'application/pdf', storageKey: 'email/org1/e1/0',
    });

    const file = await service.attachmentFor(AGENT, 'e1', 'a1');

    expect(prisma.mailboxAttachment.findFirst.mock.calls[0][0].where).toEqual({
      id: 'a1',
      mailboxMessage: visibleEmailWhere(AGENT, 'e1'),
    });
    expect(file).toEqual({ key: 'email/org1/e1/0', filename: 'v.pdf', contentType: 'application/pdf' });
  });

  it('anexo não guardado (grande demais) ou de outra org: 404', async () => {
    const { prisma, service } = setup();
    prisma.mailboxAttachment.findFirst.mockResolvedValueOnce({ filename: 'x', contentType: 'x', storageKey: null });
    await expect(service.attachmentFor(ADMIN, 'e1', 'a1')).rejects.toBeInstanceOf(NotFoundException);

    prisma.mailboxAttachment.findFirst.mockResolvedValueOnce({ filename: 'x', contentType: 'x', storageKey: 'email/org2/e/0' });
    await expect(service.attachmentFor(ADMIN, 'e1', 'a1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
