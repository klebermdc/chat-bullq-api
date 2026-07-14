import { normalizeBrazilNumber } from './phone.util';

describe('normalizeBrazilNumber', () => {
  it('remove máscara e mantém dígitos', () => {
    expect(normalizeBrazilNumber('(11) 99999-8888')).toBe('5511999998888');
  });
  it('adiciona DDI 55 quando ausente (11 dígitos)', () => {
    expect(normalizeBrazilNumber('11999998888')).toBe('5511999998888');
  });
  it('preserva DDI 55 quando já presente (13 dígitos)', () => {
    expect(normalizeBrazilNumber('5511999998888')).toBe('5511999998888');
  });
  it('lida com whatsapp jid (sufixo)', () => {
    expect(normalizeBrazilNumber('5511999998888@c.us')).toBe('5511999998888');
  });
  it('lança em número curto demais', () => {
    expect(() => normalizeBrazilNumber('123')).toThrow();
  });
});
