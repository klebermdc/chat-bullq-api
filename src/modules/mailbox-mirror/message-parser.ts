import { createHash } from 'crypto';
import { AddressObject, ParsedMail, simpleParser } from 'mailparser';
import { collectRoleAddresses, normalizeEmailAddress, RawAddress, RoleAddress } from './email-address.util';

const SNIPPET_LENGTH = 200;

export interface ParsedAttachment {
  position: number;
  filename: string | null;
  contentType: string;
  size: number;
  content: Buffer;
}

export interface ParsedEmail {
  messageId: string;
  inReplyTo: string | null;
  subject: string | null;
  fromAddr: string | null;
  fromName: string | null;
  toAddrs: string[];
  ccAddrs: string[];
  sentAt: Date | null;
  snippet: string | null;
  textBody: string | null;
  htmlBody: string | null;
  attachments: ParsedAttachment[];
  addresses: RoleAddress[];
}

type AddressField = AddressObject | AddressObject[] | undefined;

function rawAddresses(field: AddressField): RawAddress[] {
  if (!field) return [];
  const list = Array.isArray(field) ? field : [field];
  return list.flatMap((item) => item.value);
}

function plainAddresses(field: AddressField): string[] {
  return rawAddresses(field)
    .flatMap((a) => [a.address, ...(a.group ?? []).map((g) => g.address)])
    .map((a) => normalizeEmailAddress(a))
    .filter((a): a is string => a !== null);
}

function stripHtml(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

/** Prévia de uma linha para a lista: texto puro, espaços colapsados. */
export function buildSnippet(text: string | null, html: string | null): string | null {
  const source = text?.trim() ? text : html ? stripHtml(html) : '';
  const collapsed = source.replace(/\s+/g, ' ').trim();
  return collapsed ? Array.from(collapsed).slice(0, SNIPPET_LENGTH).join('') : null;
}

/** Sem Message-ID, um hash do conteúdo mantém a re-sincronização idempotente. */
function fallbackMessageId(raw: Buffer): string {
  return `<sha256-${createHash('sha256').update(raw).digest('hex')}@sendtur>`;
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * O Postgres recusa o byte NUL em TEXT e o Prisma recusa meio emoji (surrogate solto:
 * "unexpected end of hex escape"). E-mail mal formado às vezes traz os dois.
 */
export function sanitizeText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.replace(/\u0000/g, '').replace(LONE_SURROGATE, '\uFFFD');
}

const clean = sanitizeText;

function toParsedEmail(mail: ParsedMail, raw: Buffer): ParsedEmail {
  const firstFrom = rawAddresses(mail.from)[0];
  const htmlBody = clean(typeof mail.html === 'string' ? mail.html : null);
  const textBody = clean(mail.text);
  return {
    messageId: clean(mail.messageId?.trim()) || fallbackMessageId(raw),
    inReplyTo: clean(mail.inReplyTo?.trim()) || null,
    subject: clean(mail.subject),
    fromAddr: normalizeEmailAddress(firstFrom?.address),
    fromName: clean(firstFrom?.name?.trim()) || null,
    toAddrs: plainAddresses(mail.to),
    ccAddrs: plainAddresses(mail.cc),
    sentAt: mail.date ?? null,
    snippet: buildSnippet(textBody, htmlBody),
    textBody,
    htmlBody,
    attachments: mail.attachments.map((att, position) => ({
      position,
      filename: clean(att.filename),
      contentType: clean(att.contentType) || 'application/octet-stream',
      size: att.size ?? att.content.byteLength,
      content: att.content,
    })),
    addresses: collectRoleAddresses({
      from: rawAddresses(mail.from),
      replyTo: rawAddresses(mail.replyTo),
      to: rawAddresses(mail.to),
      cc: rawAddresses(mail.cc),
    }),
  };
}

/** Converte a mensagem crua (RFC 822) no formato que a gente grava. */
export async function parseRawEmail(raw: Buffer): Promise<ParsedEmail> {
  const mail = await simpleParser(raw, { skipImageLinks: true });
  return toParsedEmail(mail, raw);
}
