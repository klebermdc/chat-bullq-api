import { normalizeLeadPhone, detectSpam } from './website-lead-validation';

describe('normalizeLeadPhone', () => {
  it.each([
    ['(11) 99999-0000', '5511999990000'],
    ['+55 11 99999-0000', '5511999990000'],
    ['011 99999-0000', '5511999990000'],
    ['5511999990000', '5511999990000'],
    ['11 3333-4444', '551133334444'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeLeadPhone(raw)).toBe(expected);
  });

  it('número estrangeiro com + explícito passa como está', () => {
    expect(normalizeLeadPhone('+1 407 555 0100')).toBe('14075550100');
  });

  it.each([null, '', '123', '(00) 99999-0000', '55 11 9999', 'abc'])('%s é inválido', (raw) => {
    expect(normalizeLeadPhone(raw as any)).toBeNull();
  });

  it('BR com DDD inválido ou tamanho errado é inválido', () => {
    expect(normalizeLeadPhone('+55 10 99999-0000')).toBeNull();
    expect(normalizeLeadPhone('+55 11 999999-00000')).toBeNull();
  });
});

describe('detectSpam', () => {
  it('lead normal passa', () => {
    expect(detectSpam({ name: 'Maria Silva', email: 'maria@exemplo.com', phone: '5511999990000' })).toBeNull();
  });

  it('link no nome é spam', () => {
    expect(detectSpam({ name: 'ganhe $$ http://x.ru', email: null, phone: '5511999990000' })).toBe('link_no_nome');
  });

  it('telefone com todos os dígitos iguais é spam', () => {
    expect(detectSpam({ name: 'A', email: null, phone: '5511999999999' })).toBe('telefone_repetido');
  });

  it('e-mail inválido não derruba o lead (o telefone é o que importa)', () => {
    expect(detectSpam({ name: 'A', email: 'nao-e-email', phone: '5511987654321' })).toBeNull();
  });

  it('nome com cirílico/chinês é spam', () => {
    expect(detectSpam({ name: 'Привет', email: null, phone: '5511987654321' })).toBe('alfabeto_estranho');
  });
});
