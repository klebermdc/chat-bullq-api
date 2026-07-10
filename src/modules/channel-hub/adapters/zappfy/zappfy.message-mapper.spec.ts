import { ZappfyMessageMapper } from './zappfy.message-mapper';

describe('ZappfyMessageMapper.normalizeStatus (ack numérico Baileys)', () => {
  const mapper = new ZappfyMessageMapper();

  // Shape C: { messages: [{ id, ack }] } — ack numérico estilo Baileys.
  const ack = (n: number) =>
    mapper.normalizeStatus({ messages: [{ id: 'm1', ack: n }] })?.status;

  it('2 (SERVER_ACK) → sent, não delivered', () => {
    expect(ack(2)).toBe('sent');
  });

  it('3 (DELIVERY_ACK) → delivered, não read', () => {
    expect(ack(3)).toBe('delivered');
  });

  it('4 (READ) → read', () => {
    expect(ack(4)).toBe('read');
  });

  it('5 (PLAYED) → read, NUNCA failed', () => {
    // Regressão: o mapa antigo marcava ack 5 como "failed", fazendo toda nota
    // de voz ouvida aparecer como falha de envio.
    expect(ack(5)).toBe('read');
  });

  it('1 (PENDING) → sent', () => {
    expect(ack(1)).toBe('sent');
  });

  it('aceita status textual (shape B) em paralelo ao numérico', () => {
    const r = mapper.normalizeStatus({
      message: { messageid: 'm2', status: 'READ' },
    });
    expect(r?.status).toBe('read');
    expect(r?.externalMessageId).toBe('m2');
  });
});
