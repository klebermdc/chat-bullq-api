import { Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { resolveAssignmentScope, scopedUserWhere } from '../messaging/conversations/conversation-scope';
import { PageRequest, pagination } from './pagination';

export interface Viewer {
  organizationId: string;
  role: OrgRole | undefined;
  userId: string;
}

/** Campos da lista: sem corpo (pesado) e sem UID (BigInt não vira JSON). */
export const EMAIL_LIST_SELECT = {
  id: true,
  mailboxId: true,
  subject: true,
  fromAddr: true,
  fromName: true,
  toAddrs: true,
  ccAddrs: true,
  sentAt: true,
  snippet: true,
  hasAttachments: true,
} satisfies Prisma.MailboxMessageSelect;

const EMAIL_ORDER: Prisma.MailboxMessageOrderByWithRelationInput[] = [
  { sentAt: { sort: 'desc', nulls: 'last' } },
  { id: 'desc' },
];

/**
 * Contatos que o usuário alcança. OWNER/ADMIN: qualquer um da org.
 * AGENT: só quem tem conversa dele (dono ou incluído) — a mesma barreira da inbox.
 */
export function reachableContactWhere(viewer: Viewer): Prisma.ContactWhereInput {
  const scoped = resolveAssignmentScope(viewer.role, viewer.userId);
  return {
    organizationId: viewer.organizationId,
    deletedAt: null,
    ...(scoped ? { conversations: { some: scopedUserWhere(scoped) } } : {}),
  };
}

/** E-mail visível: da org e, para AGENT, ligado a algum contato que ele alcança. */
export function visibleEmailWhere(viewer: Viewer, id: string): Prisma.MailboxMessageWhereInput {
  const scoped = resolveAssignmentScope(viewer.role, viewer.userId);
  return {
    id,
    organizationId: viewer.organizationId,
    ...(scoped ? { contacts: { some: { contact: reachableContactWhere(viewer) } } } : {}),
  };
}

@Injectable()
export class MailboxAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async listContactEmails(viewer: Viewer, contactId: string, page: PageRequest) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, ...reachableContactWhere(viewer) },
      select: { id: true },
    });
    // 404 também para o contato de outro vendedor: não confirmar que existe.
    if (!contact) throw new NotFoundException('Contato não encontrado');
    const where: Prisma.MailboxMessageWhereInput = {
      organizationId: viewer.organizationId,
      contacts: { some: { contactId } },
    };
    const [emails, total] = await Promise.all([
      this.prisma.mailboxMessage.findMany({
        where,
        select: EMAIL_LIST_SELECT,
        orderBy: EMAIL_ORDER,
        skip: page.skip,
        take: page.limit,
      }),
      this.prisma.mailboxMessage.count({ where }),
    ]);
    return { emails, pagination: pagination(page, total) };
  }

  async getEmail(viewer: Viewer, id: string) {
    const email = await this.prisma.mailboxMessage.findFirst({
      where: visibleEmailWhere(viewer, id),
      select: {
        ...EMAIL_LIST_SELECT,
        messageId: true,
        inReplyTo: true,
        textBody: true,
        htmlBody: true,
        attachments: {
          select: { id: true, position: true, filename: true, contentType: true, size: true, storageKey: true },
          orderBy: { position: 'asc' },
        },
        contacts: {
          // AGENT não vê o nome de cliente de outro vendedor que estava em cópia.
          where: { contact: reachableContactWhere(viewer) },
          select: { role: true, contact: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!email) throw new NotFoundException('E-mail não encontrado');
    return {
      ...email,
      attachments: email.attachments.map(({ storageKey, ...att }) => ({ ...att, stored: storageKey !== null })),
    };
  }

  /** Chave do anexo no MinIO, depois de checar a visibilidade do e-mail. */
  async attachmentFor(viewer: Viewer, emailId: string, attachmentId: string) {
    const attachment = await this.prisma.mailboxAttachment.findFirst({
      where: { id: attachmentId, mailboxMessage: visibleEmailWhere(viewer, emailId) },
      select: { filename: true, contentType: true, storageKey: true },
    });
    if (!attachment) throw new NotFoundException('Anexo não encontrado');
    const key = attachment.storageKey;
    const isOwnKey = !!key && key.startsWith(`email/${viewer.organizationId}/`) && !key.split('/').includes('..');
    if (!isOwnKey) throw new NotFoundException('Anexo grande demais: não foi guardado. Veja no Gmail.');
    return { key, filename: attachment.filename ?? 'anexo', contentType: attachment.contentType };
  }
}
