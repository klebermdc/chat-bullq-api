import { MailboxContactRole } from '@prisma/client';
import { buildSnippet, parseRawEmail, sanitizeText } from './message-parser';

const RAW = [
  'From: "Cliente Feliz" <Cliente@Gmail.com>',
  'To: reservas@orlandofastpass.com.br',
  'Cc: Outro <outro@hotmail.com>',
  'Subject: =?UTF-8?Q?Confirma=C3=A7=C3=A3o_da_reserva?=',
  'Date: Tue, 10 Nov 2026 14:00:00 -0300',
  'Message-ID: <abc123@mail.gmail.com>',
  'In-Reply-To: <prev@ofp>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="XX"',
  '',
  '--XX',
  'Content-Type: text/html; charset=utf-8',
  '',
  '<p>Olá,   segue o <b>voucher</b></p>',
  '--XX',
  'Content-Type: application/pdf; name="voucher.pdf"',
  'Content-Disposition: attachment; filename="voucher.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('%PDF-1.4 teste').toString('base64'),
  '--XX--',
  '',
].join('\r\n');

describe('parseRawEmail', () => {
  it('extrai cabeçalhos, corpo, anexos e endereços com papel', async () => {
    const parsed = await parseRawEmail(Buffer.from(RAW));

    expect(parsed.messageId).toBe('<abc123@mail.gmail.com>');
    expect(parsed.inReplyTo).toBe('<prev@ofp>');
    expect(parsed.subject).toBe('Confirmação da reserva');
    expect(parsed.fromAddr).toBe('cliente@gmail.com');
    expect(parsed.fromName).toBe('Cliente Feliz');
    expect(parsed.toAddrs).toEqual(['reservas@orlandofastpass.com.br']);
    expect(parsed.ccAddrs).toEqual(['outro@hotmail.com']);
    expect(parsed.sentAt?.toISOString()).toBe('2026-11-10T17:00:00.000Z');
    expect(parsed.htmlBody).toContain('<b>voucher</b>');
    expect(parsed.snippet).toBe('Olá, segue o voucher');
    expect(parsed.attachments).toEqual([
      expect.objectContaining({ position: 0, filename: 'voucher.pdf', contentType: 'application/pdf' }),
    ]);
    expect(parsed.addresses).toContainEqual({ address: 'outro@hotmail.com', role: MailboxContactRole.CC });
  });

  it('sem Message-ID usa um hash estável do conteúdo (re-sincronizar não duplica)', async () => {
    const raw = Buffer.from('From: a@b.com\r\nSubject: oi\r\n\r\ncorpo\r\n');
    const first = await parseRawEmail(raw);
    const second = await parseRawEmail(raw);

    expect(first.messageId).toMatch(/^<sha256-[0-9a-f]{64}@sendtur>$/);
    expect(first.messageId).toBe(second.messageId);
  });
});

describe('buildSnippet', () => {
  it('prefere o texto e corta em 200 caracteres', () => {
    expect(buildSnippet('a'.repeat(300), null)).toHaveLength(200);
  });

  it('cai no HTML sem tags, estilos ou scripts quando não há texto', () => {
    expect(buildSnippet(null, '<style>p{}</style><p>Oi&nbsp;você</p><script>x()</script>')).toBe('Oi você');
  });

  it('devolve null quando não há corpo', () => {
    expect(buildSnippet(null, null)).toBeNull();
  });

  it('não corta um emoji ao meio (meio emoji derruba o Prisma)', () => {
    expect(buildSnippet('a'.repeat(199) + '😀 resto', null)).toBe('a'.repeat(199) + '😀');
  });
});

describe('sanitizeText', () => {
  it('troca surrogate solto por � e tira o byte nulo', () => {
    expect(sanitizeText('a\uD83D')).toBe('a\uFFFD');
    expect(sanitizeText('\uDE00b')).toBe('\uFFFDb');
    expect(sanitizeText('x\u0000y')).toBe('xy');
  });

  it('mantém emoji inteiro e null', () => {
    expect(sanitizeText('ok 😀')).toBe('ok 😀');
    expect(sanitizeText(null)).toBeNull();
  });
});
