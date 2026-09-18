import { contactsFromMeta, contactsSummary, parseVcard } from './shared-contact.util';

describe('parseVcard', () => {
  it('lê nome e telefone preferindo o waid', () => {
    const vcard = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'N:Silva;João;;;',
      'FN:João Silva',
      'item1.TEL;waid=5511982015967:+55 11 98201-5967',
      'item1.X-ABLabel:Celular',
      'END:VCARD',
    ].join('\n');
    expect(parseVcard(vcard)).toEqual({
      name: 'João Silva',
      phones: [{ phone: '+55 11 98201-5967', waId: '5511982015967' }],
    });
  });

  it('aceita TEL sem waid e várias linhas', () => {
    const vcard = 'BEGIN:VCARD\r\nFN:Loja\r\nTEL;type=CELL:+55 (21) 99999-0000\r\nTEL:+1 415 555 1234\r\nEMAIL:a@b.com\r\nEND:VCARD';
    expect(parseVcard(vcard)).toEqual({
      name: 'Loja',
      phones: [
        { phone: '+55 (21) 99999-0000', waId: '5521999990000' },
        { phone: '+1 415 555 1234', waId: '14155551234' },
      ],
      emails: ['a@b.com'],
    });
  });

  it('usa o nome de fallback quando o vCard não tem FN', () => {
    expect(parseVcard('BEGIN:VCARD\nTEL:5511982015967\nEND:VCARD', 'Maria').name).toBe('Maria');
  });
});

describe('contactsFromMeta', () => {
  it('converte o formato da Cloud API', () => {
    const out = contactsFromMeta([
      {
        name: { formatted_name: 'João Silva', first_name: 'João' },
        phones: [{ phone: '+55 11 98201-5967', wa_id: '5511982015967', type: 'CELL' }],
        emails: [{ email: 'j@x.com' }],
        org: { company: 'ACME' },
      },
    ]);
    expect(out).toEqual([
      {
        name: 'João Silva',
        phones: [{ phone: '+55 11 98201-5967', waId: '5511982015967', type: 'CELL' }],
        emails: ['j@x.com'],
        org: 'ACME',
      },
    ]);
  });

  it('tolera lista vazia ou ausente', () => {
    expect(contactsFromMeta(undefined)).toEqual([]);
  });
});

describe('contactsSummary', () => {
  it('um contato vira o nome dele', () => {
    expect(contactsSummary([{ name: 'João', phones: [] }])).toBe('👤 João');
  });
  it('vários contatos viram a contagem', () => {
    expect(contactsSummary([{ name: 'A', phones: [] }, { name: 'B', phones: [] }])).toBe('👤 2 contatos');
  });
});
