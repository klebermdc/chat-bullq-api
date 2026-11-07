import { buildFbc, buildPurchaseEvent, hashEmailSha256, PurchaseInput } from './meta-capi.event-builder';

const NOW = new Date('2026-11-20T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function input(over: Partial<PurchaseInput> = {}): PurchaseInput {
  return {
    eventId: 'card1:won',
    eventTime: 1700000000,
    value: 1500,
    currency: 'BRL',
    now: NOW,
    contact: { phone: '5511988887777', email: 'Maria@Exemplo.com ', ctwaClid: null, ctwaClidAt: null },
    wabaId: '2338909233618213',
    pageId: null,
    siteLead: null,
    ...over,
  };
}

describe('buildPurchaseEvent', () => {
  it('clique CTWA recente: business_messaging com WABA + ctwa_clid', () => {
    const r = buildPurchaseEvent(
      input({ contact: { phone: '55', email: null, ctwaClid: 'CLID', ctwaClidAt: new Date(NOW.getTime() - 2 * DAY) } }),
    );
    expect(r).toEqual({
      ok: true,
      path: 'ctwa',
      event: expect.objectContaining({
        event_id: 'card1:won',
        action_source: 'business_messaging',
        messaging_channel: 'whatsapp',
        user_data: { whatsapp_business_account_id: '2338909233618213', ctwa_clid: 'CLID' },
      }),
    });
  });

  it('lead do site com fbclid: website + fbc montado da data do envio + hashes + IP/navegador', () => {
    const submittedAt = new Date(NOW.getTime() - 10 * DAY);
    const r = buildPurchaseEvent(
      input({
        siteLead: { submittedAt, fbclid: 'IwAR1', pageUrl: 'https://ofp.com/?utm_source=ig', ip: '1.2.3.4', userAgent: 'UA' },
      }),
    );
    expect(r.ok && r.path).toBe('site');
    const ev = (r as any).event;
    expect(ev.action_source).toBe('website');
    expect(ev.event_source_url).toBe('https://ofp.com/?utm_source=ig');
    expect(ev.user_data).toMatchObject({
      fbc: `fb.1.${submittedAt.getTime()}.IwAR1`,
      client_ip_address: '1.2.3.4',
      client_user_agent: 'UA',
      em: [hashEmailSha256('maria@exemplo.com')],
    });
    expect(ev.user_data.ph[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(ev.messaging_channel).toBeUndefined();
  });

  it('WhatsApp sem clique: caminho por hash só com page_id + WABA', () => {
    const r = buildPurchaseEvent(input({ pageId: 'PAGE1' }));
    expect(r.ok && r.path).toBe('whatsapp_hash');
    expect((r as any).event.user_data).toMatchObject({
      page_id: 'PAGE1',
      whatsapp_business_account_id: '2338909233618213',
    });
  });

  it('WhatsApp sem clique e sem page_id: não manda (a Meta rejeitaria)', () => {
    expect(buildPurchaseEvent(input())).toEqual({ ok: false, reason: 'no_page_id' });
  });

  it('clique CTWA velho cai para o próximo caminho', () => {
    const r = buildPurchaseEvent(
      input({
        pageId: 'PAGE1',
        contact: { phone: '5511988887777', email: null, ctwaClid: 'OLD', ctwaClidAt: new Date(NOW.getTime() - 30 * DAY) },
      }),
    );
    expect(r.ok && r.path).toBe('whatsapp_hash');
    expect((r as any).event.user_data.ctwa_clid).toBeUndefined();
  });

  it('lead do site sem fbclid e sem page_id: website só com hashes', () => {
    const r = buildPurchaseEvent(
      input({ siteLead: { submittedAt: NOW, fbclid: null, pageUrl: null, ip: null, userAgent: null } }),
    );
    expect(r.ok && r.path).toBe('site');
    expect((r as any).event.user_data.fbc).toBeUndefined();
  });

  it('sem nenhum dado de match → no_match_data', () => {
    expect(buildPurchaseEvent(input({ contact: null }))).toEqual({ ok: false, reason: 'no_match_data' });
  });
});

describe('buildFbc', () => {
  it('formato fb.1.<ms>.<fbclid>', () => {
    expect(buildFbc('abc', new Date(1700000000123))).toBe('fb.1.1700000000123.abc');
  });
});
