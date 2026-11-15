import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { StorageService } from '../storage/storage.service';
import { buildContactLinks, findContactsByEmail } from './contact-linker';
import { linkableAddresses } from './email-address.util';
import type { ParsedAttachment, ParsedEmail } from './message-parser';

/** Anexo acima disso não vai para o MinIO: fica só o nome e o tamanho. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export interface MailboxRef {
  id: string;
  organizationId: string;
  address: string;
  ignoredDomains: string[];
}

export type SaveResult = 'created' | 'existing';

interface AttachmentRow {
  position: number;
  filename: string | null;
  contentType: string;
  size: number;
  storageKey: string | null;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002';
}

@Injectable()
export class MessageStoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Grava uma mensagem da caixa. Idempotente pelo Message-ID: se já existe
   * (re-sincronização depois de mudar a uidValidity), só atualiza o UID.
   */
  async save(mailbox: MailboxRef, uid: number, email: ParsedEmail): Promise<SaveResult> {
    const existing = await this.prisma.mailboxMessage.findUnique({
      where: { mailboxId_messageId: { mailboxId: mailbox.id, messageId: email.messageId } },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.mailboxMessage.update({ where: { id: existing.id }, data: { uid: BigInt(uid) } });
      return 'existing';
    }
    try {
      await this.create(mailbox, uid, email);
      return 'created';
    } catch (err) {
      if (isUniqueViolation(err)) return 'existing';
      throw err;
    }
  }

  /**
   * Anexos sobem antes do insert, com o id já decidido: se o upload falhar,
   * nada fica no banco e a próxima rodada tenta de novo a mensagem inteira.
   */
  private async create(mailbox: MailboxRef, uid: number, email: ParsedEmail): Promise<void> {
    const id = randomUUID();
    const attachments = await this.uploadAttachments(mailbox.organizationId, id, email.attachments);
    const addresses = linkableAddresses(email.addresses, mailbox);
    const contacts = await findContactsByEmail(
      this.prisma,
      mailbox.organizationId,
      addresses.map((a) => a.address),
    );
    await this.prisma.mailboxMessage.create({
      data: {
        id,
        organizationId: mailbox.organizationId,
        mailboxId: mailbox.id,
        uid: BigInt(uid),
        messageId: email.messageId,
        inReplyTo: email.inReplyTo,
        subject: email.subject,
        fromAddr: email.fromAddr,
        fromName: email.fromName,
        toAddrs: email.toAddrs,
        ccAddrs: email.ccAddrs,
        sentAt: email.sentAt,
        snippet: email.snippet,
        textBody: email.textBody,
        htmlBody: email.htmlBody,
        hasAttachments: attachments.length > 0,
        attachments: { createMany: { data: attachments } },
        contacts: {
          createMany: { data: buildContactLinks(addresses, contacts), skipDuplicates: true },
        },
      },
    });
  }

  private async uploadAttachments(
    organizationId: string,
    messageId: string,
    attachments: ParsedAttachment[],
  ): Promise<AttachmentRow[]> {
    const rows: AttachmentRow[] = [];
    // Em série: um anexo por vez na memória do upload.
    for (const att of attachments) {
      rows.push(await this.uploadOne(organizationId, messageId, att));
    }
    return rows;
  }

  private async uploadOne(
    organizationId: string,
    messageId: string,
    att: ParsedAttachment,
  ): Promise<AttachmentRow> {
    const base = {
      position: att.position,
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
    };
    if (att.size > MAX_ATTACHMENT_BYTES) return { ...base, storageKey: null };
    const storageKey = `email/${organizationId}/${messageId}/${att.position}`;
    await this.storage.put(storageKey, att.content, att.contentType);
    return { ...base, storageKey };
  }
}
