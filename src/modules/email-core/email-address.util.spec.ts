import { normalizeEmail, isValidEmail } from './email-address.util';

describe('normalizeEmail', () => {
  it('baixa caixa e tira espaços das pontas', () => {
    expect(normalizeEmail('  Joao.Silva@Exemplo.COM.BR ')).toBe('joao.silva@exemplo.com.br');
  });

  it('faz dois endereços que só diferem em caixa colidirem', () => {
    expect(normalizeEmail('A@B.COM')).toBe(normalizeEmail('a@b.com'));
  });

  it('devolve null quando não há endereço', () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
  });
});

describe('isValidEmail', () => {
  it.each(['joao@exemplo.com.br', 'maria+promo@exemplo.com', 'a_b-c@sub.exemplo.io'])(
    'aceita %s',
    (e) => expect(isValidEmail(e)).toBe(true),
  );

  it.each([
    'sem-arroba.com',
    '@exemplo.com',
    'joao@',
    'joao@exemplo',
    'joao com espaco@exemplo.com',
    '',
  ])('rejeita "%s"', (e) => expect(isValidEmail(e)).toBe(false));
});
