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

  // ─── Anúncio NÃO estende mais a janela (16/11/2026) ─────────────────────
  // No número 5198-4190 (WABA nova, desde 07/11) texto livre enviado mais de
  // 24h depois do último inbound nunca chegou: 172 recusas 131070 e 169
  // presos em SENT, zero entregues — mesmo com a Meta informando 7 dias no
  // `expiration_timestamp`. A janela de texto livre volta a ser só a CSW de
  // 24h; clique em anúncio e expiração da Meta não estendem nada.

  it('clique em anúncio há 30h e inbound há 25h → fechado (sem extensão de anúncio)', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(25),
      ctwaClidAt: at(30),
      now: base,
    });
    expect(w.open).toBe(false);
    expect(w.kind).toBe('csw24');
    expect(w.expiresAt!.getTime()).toBe(at(25).getTime() + 24 * H);
  });

  it('expiração de 7 dias informada pela Meta não estende a CSW de 24h', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(72), // caso Laylla: última msg do cliente há 3 dias
      ctwaClidAt: null,
      metaWindowExpiresAt: new Date(base.getTime() + 96 * H),
      now: base,
    });
    expect(w.open).toBe(false);
    expect(w.kind).toBe('csw24');
    expect(w.expiresAt!.getTime()).toBe(at(72).getTime() + 24 * H);
  });

  it('inbound recente continua abrindo 24h mesmo com expiração da Meta menor', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: at(1),
      ctwaClidAt: null,
      metaWindowExpiresAt: new Date(base.getTime() + 1 * H),
      now: base,
    });
    expect(w.open).toBe(true);
    expect(w.expiresAt!.getTime()).toBe(at(1).getTime() + 24 * H);
  });

  it('anúncio sem inbound → fechado (só template)', () => {
    const w = computeWhatsappWindow({
      channelType: 'WHATSAPP_OFFICIAL',
      lastInboundAt: null,
      ctwaClidAt: at(2),
      metaWindowExpiresAt: new Date(base.getTime() + 100 * H),
      now: base,
    });
    expect(w.open).toBe(false);
    expect(w.expiresAt).toBeNull();
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

  // ─── Messenger: janela aplicável, mas SEM extensão de 72h ──────────────
  // A extensão de 72h do Click-to-WhatsApp e o `metaWindowExpiresAt` são
  // conceitos exclusivos da API oficial do WhatsApp. Se vazassem pro
  // Messenger, uma conversa ganharia 72h indevidas e a Meta recusaria o
  // envio quando a janela real (24h) já tivesse fechado.

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

  it('Messenger: ctwaClidAt é ignorado mesmo dentro das 72h (CSW fechada → fechado)', () => {
    const w = computeWhatsappWindow({
      channelType: 'MESSENGER',
      lastInboundAt: at(30), // CSW fechou
      ctwaClidAt: at(30), // estaria dentro das 72h se contasse — não deve contar
      now: base,
    });
    expect(w.open).toBe(false);
    // A janela vigente continua sendo a CSW de 24h (fechada) — se o CTWA
    // tivesse vazado pro Messenger, `open` seria true (dentro das 72h).
    expect(w.kind).toBe('csw24');
  });

  it('Messenger: metaWindowExpiresAt é ignorado (conceito exclusivo do WhatsApp)', () => {
    const w = computeWhatsappWindow({
      channelType: 'MESSENGER',
      lastInboundAt: at(30), // CSW fechou
      ctwaClidAt: null,
      metaWindowExpiresAt: new Date(base.getTime() + 10 * H), // estenderia se contasse
      now: base,
    });
    expect(w.open).toBe(false);
    // Se a expiração da Meta contasse, `expiresAt` seria essa data futura e
    // `open` seria true — a expiração real permanece a CSW (no passado).
    expect(w.expiresAt!.getTime()).toBe(at(30).getTime() + 24 * H);
  });
});
