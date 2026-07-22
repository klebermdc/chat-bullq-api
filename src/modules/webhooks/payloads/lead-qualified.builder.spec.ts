import { LeadQualifiedPayloadBuilder } from './lead-qualified.builder';
import { createHash } from 'crypto';

function build(overrides: { contact?: any; tag?: any; channel?: any } = {}) {
  const prisma = {
    contact: {
      findUnique: jest.fn().mockResolvedValue(
        overrides.contact === undefined
          ? {
              id: 'ctt_1',
              phone: '+55 (11) 99999-8888',
              ctwaClid: 'ARAbc123',
              ctwaSourceId: '120210000000000',
              ctwaSourceType: 'ad',
              ctwaClidAt: new Date('2026-07-22T13:41:02.000Z'),
            }
          : overrides.contact,
      ),
    },
    tag: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          overrides.tag === undefined ? { name: 'lead-qualificado' } : overrides.tag,
        ),
    },
    channel: {
      findUnique: jest.fn().mockResolvedValue(
        overrides.channel === undefined
          ? { name: 'Orlando Fast Pass - Comercial', type: 'WHATSAPP_OFFICIAL' }
          : overrides.channel,
      ),
    },
  };
  return {
    prisma,
    builder: new LeadQualifiedPayloadBuilder(prisma as any),
  };
}

const payload = {
  contactId: 'ctt_1',
  conversationId: 'cvs_7',
  channelId: 'chn_3',
  tagId: 'tag_9',
  occurredAt: '2026-07-22T14:03:11.482Z',
};

describe('LeadQualifiedPayloadBuilder', () => {
  it('leva o ctwa_clid SEM hash — é o que atribui a venda ao anúncio', async () => {
    const { builder } = build();
    const out = await builder.build(payload);

    expect(out.attribution).toEqual({
      ctwaClid: 'ARAbc123',
      sourceId: '120210000000000',
      sourceType: 'ad',
      clickedAt: '2026-07-22T13:41:02.000Z',
    });
  });

  it('hasheia o telefone em sha256 só com dígitos, como a Meta espera', async () => {
    const { builder } = build();
    const out = await builder.build(payload);

    // "+55 (11) 99999-8888" -> "5511999998888"
    const esperado = createHash('sha256')
      .update('5511999998888')
      .digest('hex');
    expect(out.contact.phoneSha256).toBe(esperado);
    expect(out.contact.phoneSha256).not.toContain('+');
  });

  it('manda attribution null quando o lead não veio de anúncio', async () => {
    const { builder } = build({
      contact: {
        id: 'ctt_1',
        phone: '5511999998888',
        ctwaClid: null,
        ctwaSourceId: null,
        ctwaSourceType: null,
        ctwaClidAt: null,
      },
    });
    const out = await builder.build(payload);

    // null explícito distingue "orgânico" de "campo faltando por erro".
    expect(out.attribution).toBeNull();
  });

  it('usa a conversa como eventId, para casar com a chave de dedupe do outbox', async () => {
    const { builder } = build();
    const out = await builder.build(payload);
    expect(out.eventId).toBe('cvs_7:qualified');
  });

  it('não quebra quando o contato sumiu ou não tem telefone', async () => {
    const { builder } = build({ contact: null });
    const out = await builder.build(payload);

    expect(out.contact.phoneSha256).toBeNull();
    expect(out.attribution).toBeNull();
    expect(out.event).toBe('LEAD_QUALIFIED');
  });
});
