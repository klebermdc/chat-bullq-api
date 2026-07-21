import { WhatsAppOfficialMessageMapper } from './whatsapp-official.message-mapper';

describe('WhatsAppOfficialMessageMapper.normalizeStatus', () => {
  const mapper = new WhatsAppOfficialMessageMapper();

  it('extrai conversation + pricing quando presentes', () => {
    const out = mapper.normalizeStatus({
      id: 'wamid.ABC',
      status: 'sent',
      timestamp: '1700000000',
      conversation: {
        id: 'CONV123',
        origin: { type: 'marketing' },
        expiration_timestamp: '1700086400',
      },
      pricing: { billable: true, category: 'marketing', pricing_model: 'CBP' },
    });

    expect(out).toMatchObject({
      externalMessageId: 'wamid.ABC',
      status: 'sent',
      conversation: {
        id: 'CONV123',
        originType: 'marketing',
        expirationTimestamp: 1700086400,
      },
      pricing: { billable: true, category: 'marketing', pricingModel: 'CBP' },
    });
  });

  it('deixa conversation/pricing undefined quando ausentes (delivered repetido)', () => {
    const out = mapper.normalizeStatus({
      id: 'wamid.ABC',
      status: 'delivered',
      timestamp: '1700000100',
    });
    expect(out?.conversation).toBeUndefined();
    expect(out?.pricing).toBeUndefined();
  });

  it('não quebra com conversation sem pricing (usa origin.type como categoria depois)', () => {
    const out = mapper.normalizeStatus({
      id: 'wamid.XYZ',
      status: 'sent',
      timestamp: '1700000000',
      conversation: { id: 'CONV999', origin: { type: 'service' } },
    });
    expect(out?.conversation).toEqual({
      id: 'CONV999',
      originType: 'service',
      expirationTimestamp: undefined,
    });
    expect(out?.pricing).toBeUndefined();
  });

  it('preserva billable: false (não coage para true)', () => {
    const out = mapper.normalizeStatus({
      id: 'wamid.FREE',
      status: 'sent',
      timestamp: '1700000000',
      pricing: { billable: false, category: 'service', pricing_model: 'CBP' },
    });
    expect(out?.pricing?.billable).toBe(false);
  });
});

describe('WhatsAppOfficialMessageMapper — captura de referral (Click-to-WhatsApp)', () => {
  const mapper = new WhatsAppOfficialMessageMapper();

  const baseMessage = {
    id: 'wamid.123',
    from: '5511999999999',
    timestamp: '1720483200',
    type: 'text',
    text: { body: 'Oi, vim do anúncio' },
  };

  it('extrai ctwa_clid + source do referral na 1ª mensagem pós-clique', () => {
    const res = mapper.normalizeInbound(
      {
        ...baseMessage,
        referral: {
          ctwa_clid: 'CLID_ABC123',
          source_id: '120210000000000',
          source_type: 'ad',
        },
      },
      { profile: { name: 'Lead' } },
    );

    expect(res?.referral).toEqual({
      ctwaClid: 'CLID_ABC123',
      sourceId: '120210000000000',
      sourceType: 'ad',
    });
  });

  it('não seta referral em mensagem normal (sem anúncio)', () => {
    const res = mapper.normalizeInbound(baseMessage, {
      profile: { name: 'Lead' },
    });
    expect(res?.referral).toBeUndefined();
  });

  it('ignora referral sem ctwa_clid (ex.: referral só com headline)', () => {
    const res = mapper.normalizeInbound(
      { ...baseMessage, referral: { source_type: 'ad', headline: 'Promo' } },
      { profile: { name: 'Lead' } },
    );
    expect(res?.referral).toBeUndefined();
  });
});
