import { computeWhatsappWindow } from './whatsapp-window.util';

const H = 60 * 60 * 1000;
const base = new Date('2026-07-25T12:00:00.000Z');
const at = (hoursAgo: number) => new Date(base.getTime() - hoursAgo * H);

describe('computeWhatsappWindow', () => {
  it('canal não-oficial → não aplicável e sempre aberto', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_ZAPPFY',
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

  // ─── Expiração autoritativa da Meta (status webhook) ───────────────────
  // Caso real de 2026-08-06: sob pricing PMP a Meta parou de mandar
  // `referral` na inbound e só informa o free entry point no status de saída
  // (`pricing.category=referral_conversion` + `conversation.expiration_
  // timestamp`). Sem isso o lead de anúncio caía em 24h — selo errado, gate
  // recusando texto livre e cadência morrendo com "janela fechada".

  it('Meta 72h manda mesmo sem ctwaClidAt (referral não veio na inbound)', () => {
    const metaExpiry = new Date(at(25).getTime() + 72 * H); // inbound+72h
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(25), // CSW de 24h já fechou
      ctwaClidAt: null, // referral ausente — é o bug
      metaWindowExpiresAt: metaExpiry,
      now: base,
    });
    expect(w.open).toBe(true);
    expect(w.kind).toBe('ctwa72');
    expect(w.expiresAt!.getTime()).toBe(metaExpiry.getTime());
  });

  it('expiração da Meta NUNCA encurta a CSW de 24h', () => {
    const metaExpiry = new Date(base.getTime() + 1 * H); // bem antes da CSW
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(1), // CSW até base+23h
      ctwaClidAt: null,
      metaWindowExpiresAt: metaExpiry,
      now: base,
    });
    expect(w.kind).toBe('csw24');
    expect(w.expiresAt!.getTime()).toBe(at(1).getTime() + 24 * H);
  });

  it('Meta já expirada e CSW fechada → fechado', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(80),
      ctwaClidAt: null,
      metaWindowExpiresAt: at(5), // venceu há 5h
      now: base,
    });
    expect(w.open).toBe(false);
    // Continua sendo a MAIOR das expirações — só que todas no passado.
    expect(w.expiresAt!.getTime()).toBe(at(5).getTime());
  });

  it('canal não-oficial ignora a expiração da Meta', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_ZAPPFY',
      lastInboundAt: at(100),
      ctwaClidAt: null,
      metaWindowExpiresAt: new Date(base.getTime() + 10 * H),
      now: base,
    });
    expect(w).toEqual({ applicable: false, open: true, expiresAt: null, kind: null });
  });
});
