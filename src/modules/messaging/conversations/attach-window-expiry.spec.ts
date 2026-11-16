import { attachWindowExpiry } from './attach-window-expiry';

const now = new Date('2026-07-25T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

describe('attachWindowExpiry', () => {
  it('anexa windowExpiresAt (ISO) e windowKind para canal oficial', () => {
    const out = attachWindowExpiry(
      {
        id: 'c1',
        lastInboundAt: hoursAgo(1),
        channel: { type: 'WHATSAPP_OFFICIAL' },
        contact: { ctwaClidAt: null },
      },
      now,
    );
    expect(out.windowKind).toBe('csw24');
    expect(out.windowExpiresAt).toBe(
      new Date(hoursAgo(1).getTime() + 24 * 3600_000).toISOString(),
    );
  });

  it('clique em anúncio não estende: vale a CSW de 24h', () => {
    const out = attachWindowExpiry(
      {
        id: 'c1',
        lastInboundAt: hoursAgo(30),
        channel: { type: 'WHATSAPP_OFFICIAL' },
        contact: { ctwaClidAt: hoursAgo(40) },
      },
      now,
    );
    expect(out.windowKind).toBe('csw24');
    expect(out.windowExpiresAt).toBe(
      new Date(hoursAgo(30).getTime() + 24 * 3600_000).toISOString(),
    );
  });

  it('canal não-oficial → windowExpiresAt null', () => {
    const out = attachWindowExpiry(
      {
        id: 'c1',
        lastInboundAt: hoursAgo(1),
        channel: { type: 'WHATSAPP_ZAPPFY' },
        contact: { ctwaClidAt: null },
      },
      now,
    );
    expect(out.windowExpiresAt).toBeNull();
    expect(out.windowKind).toBeNull();
  });

  it('expiração informada pela Meta não estende a janela além de 24h', () => {
    const metaExpiry = new Date(now.getTime() + 50 * 60 * 60 * 1000);
    const out = attachWindowExpiry(
      {
        lastInboundAt: new Date(now.getTime() - 25 * 60 * 60 * 1000), // CSW fechada
        metaWindowExpiresAt: metaExpiry,
        channel: { type: 'WHATSAPP_OFFICIAL' },
        contact: { ctwaClidAt: null }, // referral não veio na inbound
      },
      now,
    );
    expect(out.windowExpiresAt).toBe(
      new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString(),
    );
    expect(out.windowKind).toBe('csw24');
  });

  it('preserva os campos originais da conversa', () => {
    const conv = {
      id: 'c1',
      lastInboundAt: null,
      channel: { type: 'WHATSAPP_ZAPPFY' },
      contact: { ctwaClidAt: null },
      unreadCount: 3,
    };
    const out = attachWindowExpiry(conv, now);
    expect(out.id).toBe('c1');
    expect((out as any).unreadCount).toBe(3);
  });
});
