import { MetaCapiProcessor } from './meta-capi.processor';

type AnyMock = jest.Mock;

function makeProcessor() {
  const prisma = {
    metaCapiEvent: { findUnique: jest.fn(), upsert: jest.fn() },
    card: { findUnique: jest.fn() },
    leadSubmission: { findFirst: jest.fn().mockResolvedValue(null) },
  } as any;
  const config = { resolveConfig: jest.fn() } as any;
  const http = { sendEvents: jest.fn() } as any;
  const proc = new MetaCapiProcessor(prisma, config, http);
  return { proc, prisma, config, http };
}

const CFG = { datasetId: 'DS1', token: 'tok', testEventCode: null, pageId: 'PAGE1', enabled: true };

function cardWith(contact: any, value: any = 1500) {
  return {
    id: 'card1',
    organizationId: 'org1',
    value,
    currency: 'BRL',
    closedAt: new Date(),
    contact: contact ? { id: 'ct1', email: null, ...contact } : contact,
    conversation: { channel: { config: { businessAccountId: 'WABA1' } } },
  };
}

const job = (data = { cardId: 'card1', organizationId: 'org1' }) => ({ data }) as any;

describe('MetaCapiProcessor', () => {
  it('não envia quando a org está sem config/desligada', async () => {
    const { proc, prisma, config, http } = makeProcessor();
    prisma.metaCapiEvent.findUnique.mockResolvedValue(null);
    config.resolveConfig.mockResolvedValue(null);

    await proc.process(job());

    expect(http.sendEvents).not.toHaveBeenCalled();
    expect(prisma.metaCapiEvent.upsert).not.toHaveBeenCalled();
  });

  it('é idempotente: não reenvia evento já SENT', async () => {
    const { proc, prisma, config, http } = makeProcessor();
    prisma.metaCapiEvent.findUnique.mockResolvedValue({ status: 'SENT' });

    await proc.process(job());

    expect(config.resolveConfig).not.toHaveBeenCalled();
    expect(http.sendEvents).not.toHaveBeenCalled();
  });

  it('marca SKIPPED quando não há ctwa_clid nem telefone', async () => {
    const { proc, prisma, config, http } = makeProcessor();
    prisma.metaCapiEvent.findUnique.mockResolvedValue(null);
    config.resolveConfig.mockResolvedValue(CFG);
    prisma.card.findUnique.mockResolvedValue(
      cardWith({ phone: null, ctwaClid: null, ctwaClidAt: null }),
    );

    await proc.process(job());

    expect(http.sendEvents).not.toHaveBeenCalled();
    expect(prisma.metaCapiEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: 'SKIPPED', eventId: 'card1:won' }),
      }),
    );
  });

  it('envia Purchase com ctwa_clid + ph e grava SENT (clique recente)', async () => {
    const { proc, prisma, config, http } = makeProcessor();
    prisma.metaCapiEvent.findUnique.mockResolvedValue(null);
    config.resolveConfig.mockResolvedValue(CFG);
    prisma.card.findUnique.mockResolvedValue(
      cardWith({
        phone: '+55 11 99999-9999',
        ctwaClid: 'CLID1',
        ctwaClidAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 dias
      }),
    );
    http.sendEvents.mockResolvedValue({ ok: true, status: 200, body: { events_received: 1 } });

    await proc.process(job());

    const sent = (http.sendEvents as AnyMock).mock.calls[0][0];
    const event = sent.data[0];
    expect(event.event_name).toBe('Purchase');
    expect(event.event_id).toBe('card1:won');
    expect(event.action_source).toBe('business_messaging');
    expect(event.user_data).toEqual({ whatsapp_business_account_id: 'WABA1', ctwa_clid: 'CLID1' });
    expect(event.custom_data).toEqual({ value: 1500, currency: 'BRL' });
    expect(prisma.metaCapiEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: 'SENT' }) }),
    );
  });

  it('fora da janela de atribuição: envia por hash (page_id + WABA + ph), sem ctwa_clid', async () => {
    const { proc, prisma, config, http } = makeProcessor();
    prisma.metaCapiEvent.findUnique.mockResolvedValue(null);
    config.resolveConfig.mockResolvedValue(CFG);
    prisma.card.findUnique.mockResolvedValue(
      cardWith({
        phone: '5511999999999',
        ctwaClid: 'CLID_OLD',
        ctwaClidAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 dias
      }),
    );
    http.sendEvents.mockResolvedValue({ ok: true, status: 200, body: {} });

    await proc.process(job());

    const event = (http.sendEvents as AnyMock).mock.calls[0][0].data[0];
    expect(event.user_data.ctwa_clid).toBeUndefined();
    expect(event.user_data.ph).toBeDefined();
    expect(event.user_data.page_id).toBe('PAGE1');
    expect(event.user_data.whatsapp_business_account_id).toBe('WABA1');
  });

  it('falha no envio grava FAILED e lança (pra retry da fila)', async () => {
    const { proc, prisma, config, http } = makeProcessor();
    prisma.metaCapiEvent.findUnique.mockResolvedValue(null);
    config.resolveConfig.mockResolvedValue(CFG);
    prisma.card.findUnique.mockResolvedValue(
      cardWith({ phone: '5511999999999', ctwaClid: null, ctwaClidAt: null }),
    );
    http.sendEvents.mockResolvedValue({ ok: false, status: 400, body: { error: 'bad' } });

    await expect(proc.process(job())).rejects.toThrow(/CAPI send failed/);
    expect(prisma.metaCapiEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });

  it('lead do site com fbclid: Purchase com action_source website e fbc', async () => {
    const { proc, prisma, config, http } = makeProcessor();
    prisma.metaCapiEvent.findUnique.mockResolvedValue(null);
    config.resolveConfig.mockResolvedValue(CFG);
    prisma.card.findUnique.mockResolvedValue(
      cardWith({ phone: '5511999999999', ctwaClid: null, ctwaClidAt: null }),
    );
    const submittedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    prisma.leadSubmission.findFirst.mockResolvedValue({
      createdAt: submittedAt,
      attribution: { fbclid: 'IwAR1', page_url: 'https://ofp.com/', user_agent: 'UA', ip: '1.2.3.4' },
    });
    http.sendEvents.mockResolvedValue({ ok: true, status: 200, body: {} });

    await proc.process(job());

    const event = (http.sendEvents as AnyMock).mock.calls[0][0].data[0];
    expect(event.action_source).toBe('website');
    expect(event.user_data.fbc).toBe(`fb.1.${submittedAt.getTime()}.IwAR1`);
    expect(event.event_id).toBe('card1:won');
  });
});
