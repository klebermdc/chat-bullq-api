import { attachWindowExpiry } from './attach-window-expiry';

const now = new Date('2026-07-25T12:00:00.000Z');
const H = 3600_000;
const hoursAgo = (h: number) => new Date(now.getTime() - h * H);

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
      new Date(hoursAgo(1).getTime() + 24 * H).toISOString(),
    );
    expect(out.freeEntryExpiresAt).toBeNull();
  });

  it('CTWA NÃO estende o texto livre — vira freeEntryExpiresAt (template grátis)', () => {
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
      new Date(hoursAgo(30).getTime() + 24 * H).toISOString(),
    );
    expect(out.freeEntryExpiresAt).toBe(
      new Date(hoursAgo(40).getTime() + 72 * H).toISOString(),
    );
  });

  it('expiração da Meta vira freeEntryExpiresAt', () => {
    const metaExpiry = new Date(now.getTime() + 50 * H);
    const out = attachWindowExpiry(
      {
        lastInboundAt: hoursAgo(25),
        metaWindowExpiresAt: metaExpiry,
        channel: { type: 'WHATSAPP_OFFICIAL' },
        contact: { ctwaClidAt: null },
      },
      now,
    );
    expect(out.windowExpiresAt).toBe(
      new Date(hoursAgo(25).getTime() + 24 * H).toISOString(),
    );
    expect(out.freeEntryExpiresAt).toBe(metaExpiry.toISOString());
  });

  it('canal não-oficial → tudo null', () => {
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
    expect(out.freeEntryExpiresAt).toBeNull();
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
