import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { EMAIL_LIST_SELECT } from './mailbox-access.service';
import { PageRequest, pagination } from './pagination';

/** Telas de gestão (OWNER/ADMIN): status das caixas e a caixa inteira. */
@Injectable()
export class MailboxAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async listMailboxes(organizationId: string) {
    const rows = await this.prisma.mailbox.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        address: true,
        imapHost: true,
        folder: true,
        enabled: true,
        lastUid: true,
        lastSyncAt: true,
        lastError: true,
        passwordEnv: true,
        _count: { select: { messages: true } },
      },
    });
    // BigInt não serializa em JSON: vira string.
    return rows.map(({ lastUid, _count, ...row }) => ({
      ...row,
      lastUid: lastUid.toString(),
      messageCount: _count.messages,
    }));
  }

  async listMailboxEmails(organizationId: string, mailboxId: string, unlinkedOnly: boolean, page: PageRequest) {
    const mailbox = await this.prisma.mailbox.findFirst({
      where: { id: mailboxId, organizationId },
      select: { id: true },
    });
    if (!mailbox) throw new NotFoundException('Caixa não encontrada');
    const where: Prisma.MailboxMessageWhereInput = {
      organizationId,
      mailboxId,
      ...(unlinkedOnly ? { contacts: { none: {} } } : {}),
    };
    const [emails, total] = await Promise.all([
      this.prisma.mailboxMessage.findMany({
        where,
        select: {
          ...EMAIL_LIST_SELECT,
          contacts: { select: { role: true, contact: { select: { id: true, name: true } } } },
        },
        orderBy: [{ sentAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        skip: page.skip,
        take: page.limit,
      }),
      this.prisma.mailboxMessage.count({ where }),
    ]);
    return { emails, pagination: pagination(page, total) };
  }
}
