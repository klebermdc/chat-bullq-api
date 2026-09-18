import { buildQuotePreview, resolveInboundReplyTo } from './reply-context.resolver';

describe('buildQuotePreview', () => {
  it('usa texto, depois legenda, depois o tipo', () => {
    expect(buildQuotePreview({ type: 'TEXT', content: { text: 'oi' } })).toBe('oi');
    expect(buildQuotePreview({ type: 'IMAGE', content: { caption: 'Hotel' } })).toBe('Hotel');
    expect(buildQuotePreview({ type: 'AUDIO', content: {} })).toBe('[audio]');
  });

  it('corta prévia longa', () => {
    const long = 'x'.repeat(500);
    expect(buildQuotePreview({ type: 'TEXT', content: { text: long } }).length).toBeLessThanOrEqual(160);
  });
});

/**
 * O cliente respondeu citando a cotação que o atendente mandou. A Meta só
 * manda o id (wamid) da citada — o texto tem que vir do nosso banco.
 */
describe('resolveInboundReplyTo', () => {
  function make(original: any) {
    return {
      conversation: {
        findUnique: jest.fn().mockResolvedValue({ contactId: 'c1', channelId: 'ch1', contact: { name: 'Cliente' } }),
      },
      message: { findFirst: jest.fn().mockResolvedValue(original) },
    } as any;
  }

  it('completa prévia e remetente com a mensagem nossa citada', async () => {
    const prisma = make({
      id: 'm-cot', type: 'TEXT', content: { text: 'Cotação: 4 ingressos' },
      direction: 'OUTBOUND', senderName: null, sender: { name: 'Kleber' },
    });
    const out = await resolveInboundReplyTo(prisma, 'conv1', { externalMessageId: 'wamid.ORIG' });
    expect(out).toEqual({
      externalMessageId: 'wamid.ORIG', messageId: 'm-cot',
      previewText: 'Cotação: 4 ingressos', senderName: 'Kleber', fromMe: true,
    });
    // Procura em TODAS as conversas do contato no canal — a cotação pode ser
    // de um atendimento anterior, já encerrado.
    expect(prisma.message.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { externalId: 'wamid.ORIG', conversation: { contactId: 'c1', channelId: 'ch1' } },
    }));
  });

  it('mensagem do próprio cliente citada leva o nome dele', async () => {
    const prisma = make({ id: 'm2', type: 'TEXT', content: { text: 'quanto fica?' }, direction: 'INBOUND', senderName: null, sender: null });
    const out = await resolveInboundReplyTo(prisma, 'conv1', { externalMessageId: 'X' });
    expect(out?.senderName).toBe('Cliente');
    expect(out?.fromMe).toBe(false);
  });

  it('não achou no banco: mantém a prévia que veio do provedor', async () => {
    const prisma = make(null);
    const out = await resolveInboundReplyTo(prisma, 'conv1', { externalMessageId: 'X', previewText: 'do payload' });
    expect(out).toEqual({ externalMessageId: 'X', previewText: 'do payload' });
  });

  it('sem id citado (story/anúncio) não consulta nada', async () => {
    const prisma = make(null);
    const ctx = { story: { id: 's1' } };
    expect(await resolveInboundReplyTo(prisma, 'conv1', ctx)).toBe(ctx);
    expect(prisma.message.findFirst).not.toHaveBeenCalled();
  });

  it('sem replyTo devolve undefined', async () => {
    expect(await resolveInboundReplyTo(make(null), 'conv1', undefined)).toBeUndefined();
  });
});
