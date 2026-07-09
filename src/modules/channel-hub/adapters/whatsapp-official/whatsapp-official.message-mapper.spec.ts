import { WhatsAppOfficialMessageMapper } from './whatsapp-official.message-mapper';

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
