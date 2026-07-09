import { normalizePhone, phoneMatchSuffix } from './phone.util';

describe('normalizePhone', () => {
  it('remove tudo que nao for digito', () => {
    expect(normalizePhone('+55 (11) 98201-5967')).toBe('5511982015967');
  });
  it('lanca em telefone curto (<10 digitos)', () => {
    expect(() => normalizePhone('123')).toThrow(/telefone/i);
  });
  it('lanca em vazio', () => {
    expect(() => normalizePhone('')).toThrow(/telefone/i);
  });
});

describe('phoneMatchSuffix', () => {
  it('devolve os últimos 10 dígitos do telefone normalizado', () => {
    expect(phoneMatchSuffix(normalizePhone('+55 (11) 98201-5967'))).toBe('5511982015967'.slice(-10));
  });

  it('casa E.164 (com 55) e número digitado sem DDI pelo mesmo sufixo', () => {
    const fromWhatsapp = normalizePhone('5511982015967'); // 13 dígitos
    const fromForm = normalizePhone('11982015967'); // 11 dígitos, sem DDI
    expect(phoneMatchSuffix(fromWhatsapp)).toBe(phoneMatchSuffix(fromForm));
  });

  it('devolve a string inteira quando tem menos de 10 dígitos', () => {
    expect(phoneMatchSuffix('12345678')).toBe('12345678');
  });
});
