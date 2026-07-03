import { normalizePhone } from './phone.util';

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
