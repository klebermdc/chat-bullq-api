import {
  buildBillingUpsertArgs,
  extractBillingFromWebhookPayload,
  toBillingRow,
} from './message-billing.mapper';

const AT = new Date('2026-10-02T14:00:00Z');

describe('toBillingRow', () => {
  it('mapeia o pricing do status para uma linha por wamid', () => {
    const row = toBillingRow({
      externalMessageId: 'wamid.A',
      timestamp: AT,
      pricing: {
        billable: false,
        category: 'service',
        pricingModel: 'PMP',
        type: 'free_customer_service',
      },
    });
    expect(row).toEqual({
      externalMessageId: 'wamid.A',
      category: 'service',
      pricingType: 'free_customer_service',
      billable: false,
      pricingModel: 'PMP',
      statusAt: AT,
    });
  });

  it('devolve null quando o status não traz pricing', () => {
    expect(toBillingRow({ externalMessageId: 'wamid.A', timestamp: AT })).toBeNull();
  });

  it('devolve null sem wamid ou com timestamp inválido', () => {
    const pricing = { billable: true, category: 'marketing' };
    expect(toBillingRow({ externalMessageId: '', timestamp: AT, pricing })).toBeNull();
    expect(
      toBillingRow({
        externalMessageId: 'wamid.A',
        timestamp: new Date('nope'),
        pricing,
      }),
    ).toBeNull();
  });

  it('pricing incompleto vira unknown / null / não cobrável', () => {
    const row = toBillingRow({
      externalMessageId: 'wamid.A',
      timestamp: AT,
      pricing: {},
    });
    expect(row).toMatchObject({
      category: 'unknown',
      pricingType: null,
      billable: false,
      pricingModel: null,
    });
  });
});

describe('buildBillingUpsertArgs', () => {
  const base = {
    externalMessageId: 'wamid.A',
    category: 'service',
    pricingType: 'regular',
    billable: true,
    pricingModel: 'PMP',
    statusAt: AT,
  };

  it('cria com todos os campos e usa a chave única (canal, wamid)', () => {
    const args = buildBillingUpsertArgs('org1', 'chan1', base);
    expect(args.where).toEqual({
      uq_billing_channel_message: {
        channelId: 'chan1',
        externalMessageId: 'wamid.A',
      },
    });
    expect(args.create).toEqual({
      organizationId: 'org1',
      channelId: 'chan1',
      ...base,
    });
  });

  it('no update só leva os campos que o payload trouxe de fato', () => {
    const args = buildBillingUpsertArgs('org1', 'chan1', {
      ...base,
      category: 'unknown',
      pricingType: null,
      pricingModel: null,
      billable: false,
    });
    expect(args.update).toEqual({});
  });

  it('nunca leva billable:false no update (não desfaz um cobrável)', () => {
    const args = buildBillingUpsertArgs('org1', 'chan1', {
      ...base,
      billable: false,
      pricingType: 'free_customer_service',
    });
    expect(args.update).not.toHaveProperty('billable');
    expect(args.update).toEqual({
      category: 'service',
      pricingType: 'free_customer_service',
      pricingModel: 'PMP',
    });
  });

  it('leva billable:true no update e nunca regrava o statusAt', () => {
    const args = buildBillingUpsertArgs('org1', 'chan1', base);
    expect(args.update).toEqual({
      category: 'service',
      pricingType: 'regular',
      pricingModel: 'PMP',
      billable: true,
    });
    expect(args.update).not.toHaveProperty('statusAt');
  });
});

describe('extractBillingFromWebhookPayload', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA1',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: 'PN1', display_phone_number: '5511' },
              statuses: [
                {
                  id: 'wamid.A',
                  status: 'sent',
                  timestamp: '1790949600',
                  pricing: {
                    billable: true,
                    pricing_model: 'PMP',
                    type: 'regular',
                    category: 'marketing',
                  },
                },
                { id: 'wamid.A', status: 'read', timestamp: '1790949700' },
              ],
            },
          },
        ],
      },
    ],
  };

  it('extrai só os status que trazem pricing, com o phone_number_id', () => {
    const out = extractBillingFromWebhookPayload(payload);
    expect(out).toEqual([
      {
        phoneNumberId: 'PN1',
        row: {
          externalMessageId: 'wamid.A',
          category: 'marketing',
          pricingType: 'regular',
          billable: true,
          pricingModel: 'PMP',
          statusAt: new Date(1790949600 * 1000),
        },
      },
    ]);
  });

  it('aguenta payload sem statuses, vazio ou malformado', () => {
    expect(extractBillingFromWebhookPayload(null)).toEqual([]);
    expect(extractBillingFromWebhookPayload('texto')).toEqual([]);
    expect(extractBillingFromWebhookPayload({ entry: 'x' })).toEqual([]);
    expect(
      extractBillingFromWebhookPayload({
        entry: [{ changes: [{ value: { messages: [{ id: 'm' }] } }] }],
      }),
    ).toEqual([]);
    expect(
      extractBillingFromWebhookPayload({
        entry: [{ changes: [{ value: { statuses: [null, { id: 'x' }] } }] }],
      }),
    ).toEqual([]);
  });

  it('descarta status com timestamp ilegível', () => {
    const out = extractBillingFromWebhookPayload({
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: 'wamid.B', timestamp: 'abc', pricing: { billable: true } },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(out).toEqual([]);
  });
});
