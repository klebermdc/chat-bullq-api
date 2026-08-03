import { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token.util';

const SECRET = 'segredo-de-teste';

describe('token de descadastro', () => {
  it('assina e valida de volta o id do destinatário', () => {
    const token = signUnsubscribeToken('sub_123', SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toBe('sub_123');
  });

  it('gera token seguro para URL, sem +, / ou =', () => {
    const token = signUnsubscribeToken('sub_123', SECRET);
    expect(token).not.toMatch(/[+/=]/);
  });

  it('rejeita token adulterado no payload', () => {
    const token = signUnsubscribeToken('sub_123', SECRET);
    const [, sig] = token.split('.');
    const forjado = `${Buffer.from('sub_999').toString('base64url')}.${sig}`;
    expect(verifyUnsubscribeToken(forjado, SECRET)).toBeNull();
  });

  it('rejeita token assinado com outro segredo', () => {
    const token = signUnsubscribeToken('sub_123', 'outro-segredo');
    expect(verifyUnsubscribeToken(token, SECRET)).toBeNull();
  });

  it('rejeita token malformado sem explodir', () => {
    expect(verifyUnsubscribeToken('', SECRET)).toBeNull();
    expect(verifyUnsubscribeToken('semponto', SECRET)).toBeNull();
    expect(verifyUnsubscribeToken('a.b.c', SECRET)).toBeNull();
  });
});
