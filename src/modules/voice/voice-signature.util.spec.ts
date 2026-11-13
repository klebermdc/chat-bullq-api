import { signVoiceRequest, verifyVoiceRequest } from './voice-signature.util';

const SECRET = 'segredo-de-teste';
const NOW = new Date('2026-11-16T15:00:00Z');
const ts = String(Math.floor(NOW.getTime() / 1000));
const body = Buffer.from('{"conversationId":"cv1"}');

describe('assinatura do agente de voz', () => {
  it('aceita assinatura correta dentro de 5 minutos', () => {
    const sig = signVoiceRequest(SECRET, ts, body);
    expect(verifyVoiceRequest({ secret: SECRET, timestamp: ts, signature: sig, body, now: NOW })).toBe(true);
  });

  it('recusa corpo alterado, segredo errado e assinatura malformada', () => {
    const sig = signVoiceRequest(SECRET, ts, body);
    expect(verifyVoiceRequest({ secret: SECRET, timestamp: ts, signature: sig, body: Buffer.from('{}'), now: NOW })).toBe(false);
    expect(verifyVoiceRequest({ secret: 'outro', timestamp: ts, signature: sig, body, now: NOW })).toBe(false);
    expect(verifyVoiceRequest({ secret: SECRET, timestamp: ts, signature: 'abc', body, now: NOW })).toBe(false);
  });

  it('recusa pedido velho ou do futuro (replay) e timestamp inválido', () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 301);
    expect(verifyVoiceRequest({ secret: SECRET, timestamp: old, signature: signVoiceRequest(SECRET, old, body), body, now: NOW })).toBe(false);
    const fut = String(Math.floor(NOW.getTime() / 1000) + 301);
    expect(verifyVoiceRequest({ secret: SECRET, timestamp: fut, signature: signVoiceRequest(SECRET, fut, body), body, now: NOW })).toBe(false);
    expect(verifyVoiceRequest({ secret: SECRET, timestamp: 'x', signature: 'y', body, now: NOW })).toBe(false);
  });

  it('sem segredo configurado, recusa tudo', () => {
    expect(verifyVoiceRequest({ secret: '', timestamp: ts, signature: signVoiceRequest('', ts, body), body, now: NOW })).toBe(false);
  });
});
