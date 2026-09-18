import { ZappfyMessageMapper } from './zappfy.message-mapper';

describe('ZappfyMessageMapper.normalizeStatus (ack numérico Baileys)', () => {
  const mapper = new ZappfyMessageMapper();

  // Shape C: { messages: [{ id, ack }] } — ack numérico estilo Baileys.
  const ack = (n: number) =>
    mapper.normalizeStatus({ messages: [{ id: 'm1', ack: n }] })?.status;

  it('2 (SERVER_ACK) → sent, não delivered', () => {
    expect(ack(2)).toBe('sent');
  });

  it('3 (DELIVERY_ACK) → delivered, não read', () => {
    expect(ack(3)).toBe('delivered');
  });

  it('4 (READ) → read', () => {
    expect(ack(4)).toBe('read');
  });

  it('5 (PLAYED) → read, NUNCA failed', () => {
    // Regressão: o mapa antigo marcava ack 5 como "failed", fazendo toda nota
    // de voz ouvida aparecer como falha de envio.
    expect(ack(5)).toBe('read');
  });

  it('1 (PENDING) → sent', () => {
    expect(ack(1)).toBe('sent');
  });

  it('aceita status textual (shape B) em paralelo ao numérico', () => {
    const r = mapper.normalizeStatus({
      message: { messageid: 'm2', status: 'READ' },
    });
    expect(r?.status).toBe('read');
    expect(r?.externalMessageId).toBe('m2');
  });
});

describe('ZappfyMessageMapper.normalizeInbound — citação e contato', () => {
  const mapper = new ZappfyMessageMapper();
  const event = (message: any) => ({ message: { chatid: '5511982015967@s.whatsapp.net', messageid: 'x1', ...message } });

  // O cliente respondeu citando uma mensagem: o id vem no contextInfo e o
  // conteúdo citado também — a prévia não depende de achar a original no banco.
  it('leva id e prévia da mensagem citada', () => {
    const out = mapper.normalizeInbound(event({
      messageType: 'ExtendedTextMessage',
      content: {
        text: 'quero essa',
        contextInfo: { stanzaId: 'ABC123', quotedMessage: { conversation: 'Cotação: 4 ingressos R$ 2.000' } },
      },
    }));
    expect(out?.replyTo).toEqual({ externalMessageId: 'ABC123', previewText: 'Cotação: 4 ingressos R$ 2.000' });
  });

  it('aceita a grafia stanzaID e o campo quoted de topo', () => {
    expect(mapper.normalizeInbound(event({
      messageType: 'ExtendedTextMessage', content: { text: 'ok', contextInfo: { stanzaID: 'S1' } },
    }))?.replyTo?.externalMessageId).toBe('S1');
    expect(mapper.normalizeInbound(event({
      messageType: 'Conversation', content: 'ok', quoted: 'Q9',
    }))?.replyTo?.externalMessageId).toBe('Q9');
  });

  it('prévia de mídia citada usa a legenda', () => {
    const out = mapper.normalizeInbound(event({
      messageType: 'ExtendedTextMessage',
      content: { text: 'essa', contextInfo: { stanzaId: 'I1', quotedMessage: { imageMessage: { caption: 'Hotel A' } } } },
    }));
    expect(out?.replyTo?.previewText).toBe('Hotel A');
  });

  it('cartão de contato vira texto-resumo + contacts estruturado', () => {
    const out = mapper.normalizeInbound(event({
      messageType: 'ContactMessage',
      content: {
        displayName: 'Maria Souza',
        vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:Maria Souza\nitem1.TEL;waid=5521999990000:+55 21 99999-0000\nEND:VCARD',
      },
    }));
    expect(out?.type).toBe('TEXT');
    expect(out?.content).toEqual({
      text: '👤 Maria Souza',
      contacts: [{ name: 'Maria Souza', phones: [{ phone: '+55 21 99999-0000', waId: '5521999990000' }] }],
    });
  });

  it('vários contatos (contactsArrayMessage)', () => {
    const out = mapper.normalizeInbound(event({
      messageType: 'ContactsArrayMessage',
      content: {
        displayName: '2 contatos',
        contacts: [
          { displayName: 'A', vcard: 'BEGIN:VCARD\nFN:A\nTEL:+55 11 91111-1111\nEND:VCARD' },
          { displayName: 'B', vcard: 'BEGIN:VCARD\nFN:B\nTEL:+55 11 92222-2222\nEND:VCARD' },
        ],
      },
    }));
    expect(out?.content.text).toBe('👤 2 contatos');
    expect(out?.content.contacts?.map((c) => c.name)).toEqual(['A', 'B']);
  });
});
