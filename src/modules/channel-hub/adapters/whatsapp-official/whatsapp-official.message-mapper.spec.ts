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
