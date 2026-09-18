import { computeWhatsappWindow } from './whatsapp-window.util';

const H = 60 * 60 * 1000;
const base = new Date('2026-07-25T12:00:00.000Z');
const at = (hoursAgo: number) => new Date(base.getTime() - hoursAgo * H);

const NOT_APPLICABLE = {
  applicable: false,
  open: true,
  expiresAt: null,
  kind: null,
  freeEntryExpiresAt: null,
};

describe('computeWhatsappWindow', () => {
  it('canal não-oficial → não aplicável e sempre aberto', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_ZAPPFY',
      lastInboundAt: at(100),
      ctwaClidAt: null,
      now: base,
    });
    expect(w).toEqual(NOT_APPLICABLE);
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
    expect(w.freeEntryExpiresAt).toBeNull();
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

  // ─── Free entry point (72h do Click-to-WhatsApp) ────────────────────────
  // Caso real de 2026-09-18 (lead Leidiany): inbound às 09:19 de 16/09, clique
  // no anúncio → Meta informou expiração de 72h. Texto livre enviado 29h
  // depois voltou `[131047] Re-engagement message`. As 72h só tornam as
  // mensagens GRATUITAS; texto livre continua preso à CSW de 24h. Tratar as
  // 72h como janela de texto derrubou 47 envios em 30 dias.

  it('CTWA dentro das 72h mas CSW fechada → texto livre FECHADO', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(25), // CSW já fechou
      ctwaClidAt: at(30), // dentro das 72h
      now: base,
    });
    expect(w.open).toBe(false);
    expect(w.kind).toBe('csw24');
    expect(w.expiresAt!.getTime()).toBe(at(25).getTime() + 24 * H);
  });

  it('CTWA vira contagem separada de template grátis (clique + 72h)', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(25),
      ctwaClidAt: at(30),
      now: base,
    });
    expect(w.freeEntryExpiresAt!.getTime()).toBe(at(30).getTime() + 72 * H);
  });

  it('expiração da Meta (status webhook) também alimenta só a contagem de template', () => {
    const metaExpiry = new Date(at(29).getTime() + 72 * H);
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(29),
      ctwaClidAt: null, // referral ausente na inbound (pricing PMP)
      metaWindowExpiresAt: metaExpiry,
      now: base,
    });
    expect(w.open).toBe(false);
    expect(w.freeEntryExpiresAt!.getTime()).toBe(metaExpiry.getTime());
  });

  it('contagem de template usa a MAIOR entre clique+72h e a expiração da Meta', () => {
    const metaExpiry = new Date(base.getTime() + 60 * H);
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(2),
      ctwaClidAt: at(40), // clique+72h = base+32h
      metaWindowExpiresAt: metaExpiry,
      now: base,
    });
    expect(w.freeEntryExpiresAt!.getTime()).toBe(metaExpiry.getTime());
  });

  it('inbound recente: texto livre aberto pela CSW, independentemente do CTWA', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(1),
      ctwaClidAt: at(71),
      now: base,
    });
    expect(w.open).toBe(true);
    expect(w.expiresAt!.getTime()).toBe(at(1).getTime() + 24 * H);
  });

  it('CTWA há 80h e sem inbound → fechado, contagem de template já vencida', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: null,
      ctwaClidAt: at(80),
      now: base,
    });
    expect(w.open).toBe(false);
    expect(w.expiresAt).toBeNull();
    expect(w.freeEntryExpiresAt!.getTime()).toBe(at(80).getTime() + 72 * H);
  });

  it('sem CTWA nem expiração da Meta → sem contagem de template', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(3),
      ctwaClidAt: null,
      now: base,
    });
    expect(w.freeEntryExpiresAt).toBeNull();
  });

  it('canal não-oficial ignora a expiração da Meta', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_ZAPPFY',
      lastInboundAt: at(100),
      ctwaClidAt: null,
      metaWindowExpiresAt: new Date(base.getTime() + 10 * H),
      now: base,
    });
    expect(w).toEqual(NOT_APPLICABLE);
  });

  // ─── Messenger: CSW de 24h, sem free entry point ───────────────────────

  it('Messenger: aplicável e regido pela CSW de 24h', () => {
    const w = computeWhatsappWindow({
      channelType: 'MESSENGER',
      lastInboundAt: at(10),
      ctwaClidAt: null,
      now: base,
    });
    expect(w.applicable).toBe(true);
    expect(w.open).toBe(true);
    expect(w.kind).toBe('csw24');
    expect(w.expiresAt!.getTime()).toBe(at(10).getTime() + 24 * H);
  });

  it('Messenger: ctwaClidAt e expiração da Meta não geram contagem de template', () => {
    const w = computeWhatsappWindow({
      channelType: 'MESSENGER',
      lastInboundAt: at(30),
      ctwaClidAt: at(30),
      metaWindowExpiresAt: new Date(base.getTime() + 10 * H),
      now: base,
    });
    expect(w.open).toBe(false);
    expect(w.freeEntryExpiresAt).toBeNull();
  });
});
