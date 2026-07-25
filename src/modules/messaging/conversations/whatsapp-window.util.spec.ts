import { computeWhatsappWindow } from './whatsapp-window.util';

const H = 60 * 60 * 1000;
const base = new Date('2026-07-25T12:00:00.000Z');
const at = (hoursAgo: number) => new Date(base.getTime() - hoursAgo * H);

describe('computeWhatsappWindow', () => {
  it('canal não-oficial → não aplicável e sempre aberto', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_WASENDER',
      lastInboundAt: at(100),
      ctwaClidAt: null,
      now: base,
    });
    expect(w).toEqual({ applicable: false, open: true, expiresAt: null, kind: null });
  });

  it('oficial, sem inbound e sem ctwa → fechado (só template abre a 1ª msg)', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: null,
      ctwaClidAt: null,
      now: base,
    });
    expect(w.applicable).toBe(true);
    expect(w.open).toBe(false);
    expect(w.expiresAt).toBeNull();
  });

  it('CSW 24h: inbound há 10h → aberto, kind csw24', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(10),
      ctwaClidAt: null,
      now: base,
    });
    expect(w.open).toBe(true);
    expect(w.kind).toBe('csw24');
    expect(w.expiresAt!.getTime()).toBe(at(10).getTime() + 24 * H);
  });

  it('CSW 24h: inbound há 25h → fechado', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(25),
      ctwaClidAt: null,
      now: base,
    });
    expect(w.open).toBe(false);
  });

  it('CTWA 72h: clique há 30h, inbound há 25h → aberto pela regra ctwa72', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(25), // CSW já fechou
      ctwaClidAt: at(30), // dentro das 72h
      now: base,
    });
    expect(w.open).toBe(true);
    expect(w.kind).toBe('ctwa72');
    expect(w.expiresAt!.getTime()).toBe(at(30).getTime() + 72 * H);
  });

  it('usa a MAIOR das duas janelas (reply recente estende além das 72h da entrada)', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(1), // CSW até base+23h
      ctwaClidAt: at(71), // ctwa até base+1h
      now: base,
    });
    expect(w.kind).toBe('csw24');
    expect(w.expiresAt!.getTime()).toBe(at(1).getTime() + 24 * H);
  });

  it('CTWA há 80h e sem inbound → fechado', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: null,
      ctwaClidAt: at(80),
      now: base,
    });
    expect(w.open).toBe(false);
  });
});
