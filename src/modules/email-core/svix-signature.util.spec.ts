import * as crypto from 'crypto';
import { verifySvixSignature } from './svix-signature.util';

const SECRET = 'whsec_' + Buffer.from('chave-secreta-do-webhook').toString('base64');

function assinar(id: string, ts: string, body: string, secret = SECRET) {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const sig = crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
  return `v1,${sig}`;
}

describe('verifySvixSignature', () => {
  const body = JSON.stringify({ type: 'email.delivered' });
  const id = 'msg_1';
  const agora = () => String(Math.floor(Date.now() / 1000));

  it('aceita assinatura válida', () => {
    const ts = agora();
    const headers = { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': assinar(id, ts, body) };
    expect(verifySvixSignature(body, headers, SECRET)).toBe(true);
  });

  it('aceita quando o header traz várias assinaturas e uma delas casa', () => {
    const ts = agora();
    const headers = {
      'svix-id': id,
      'svix-timestamp': ts,
      'svix-signature': `v1,assinaturaerrada ${assinar(id, ts, body)}`,
    };
    expect(verifySvixSignature(body, headers, SECRET)).toBe(true);
  });

  it('rejeita corpo adulterado', () => {
    const ts = agora();
    const headers = { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': assinar(id, ts, body) };
    expect(verifySvixSignature('{"type":"outra.coisa"}', headers, SECRET)).toBe(false);
  });

  it('rejeita assinatura feita com outro segredo', () => {
    const ts = agora();
    const outro = 'whsec_' + Buffer.from('segredo-diferente').toString('base64');
    const headers = { 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': assinar(id, ts, body, outro) };
    expect(verifySvixSignature(body, headers, SECRET)).toBe(false);
  });

  it('rejeita timestamp fora da tolerância (replay)', () => {
    const velho = String(Math.floor(Date.now() / 1000) - 3600);
    const headers = { 'svix-id': id, 'svix-timestamp': velho, 'svix-signature': assinar(id, velho, body) };
    expect(verifySvixSignature(body, headers, SECRET)).toBe(false);
  });

  it('rejeita quando falta header, sem explodir', () => {
    expect(verifySvixSignature(body, {}, SECRET)).toBe(false);
    expect(verifySvixSignature(body, { 'svix-id': id }, SECRET)).toBe(false);
  });
});
