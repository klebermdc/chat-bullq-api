import * as crypto from 'crypto';
import { verifyMetaSignature, handleMetaVerification } from './meta-signature.util';

const SECRET = 'segredo-de-teste';

function sign(body: Buffer, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyMetaSignature', () => {
  it('aceita assinatura correta', () => {
    const body = Buffer.from('{"object":"page"}');
    expect(verifyMetaSignature({ 'x-hub-signature-256': sign(body, SECRET) }, body, SECRET)).toBe(true);
  });

  it('recusa assinatura de outro segredo', () => {
    const body = Buffer.from('{"object":"page"}');
    expect(verifyMetaSignature({ 'x-hub-signature-256': sign(body, 'outro') }, body, SECRET)).toBe(false);
  });

  it('recusa quando o header nao veio', () => {
    expect(verifyMetaSignature({}, Buffer.from('{}'), SECRET)).toBe(false);
  });

  it('aceita sem validar quando nao ha segredo configurado', () => {
    expect(verifyMetaSignature({}, Buffer.from('{}'), undefined)).toBe(true);
  });

  it('recusa assinatura de tamanho diferente sem estourar excecao', () => {
    expect(verifyMetaSignature({ 'x-hub-signature-256': 'sha256=abc' }, Buffer.from('{}'), SECRET)).toBe(false);
  });
});

describe('handleMetaVerification', () => {
  it('devolve o challenge quando o token bate', () => {
    expect(
      handleMetaVerification(
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '999' },
        'tok',
      ),
    ).toEqual({ statusCode: 200, body: '999' });
  });

  it('recusa token errado', () => {
    expect(
      handleMetaVerification(
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'errado', 'hub.challenge': '999' },
        'tok',
      ).statusCode,
    ).toBe(403);
  });

  it('recusa quando o mode nao e subscribe', () => {
    expect(
      handleMetaVerification(
        { 'hub.mode': 'unsubscribe', 'hub.verify_token': 'tok', 'hub.challenge': '999' },
        'tok',
      ).statusCode,
    ).toBe(403);
  });
});
