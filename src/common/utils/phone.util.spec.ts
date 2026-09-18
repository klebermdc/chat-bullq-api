import { BadRequestException } from '@nestjs/common';
import { externalIdVariants, normalizePhone, phoneVariants } from './phone.util';

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
  // Erro de digitação do operador é 400, não 500 "Internal server error".
  it('lanca BadRequestException', () => {
    expect(() => normalizePhone('123')).toThrow(BadRequestException);
  });

  // Operador digitou só DDD + número: sem o 55 a mensagem ia para +1 (EUA).
  it('completa o DDI 55 quando vem so DDD + celular', () => {
    expect(normalizePhone('(11) 98201-5967')).toBe('5511982015967');
    expect(normalizePhone('11982015967')).toBe('5511982015967');
  });
  it('completa o DDI 55 quando vem so DDD + fixo', () => {
    expect(normalizePhone('(11) 3201-5967')).toBe('551132015967');
  });
  it('tira o 0 de operadora/DDD na frente', () => {
    expect(normalizePhone('011 98201-5967')).toBe('5511982015967');
    expect(normalizePhone('0055 11 98201-5967')).toBe('5511982015967');
  });
  it('respeita numero internacional com + explicito', () => {
    expect(normalizePhone('+1 415 555 1234')).toBe('14155551234');
  });
  it('mantem numero que ja veio com 55', () => {
    expect(normalizePhone('551132015967')).toBe('551132015967');
  });
});

describe('phoneVariants', () => {
  it('celular BR com 9: devolve tambem a forma sem o 9', () => {
    expect(phoneVariants('5511982015967')).toEqual(['5511982015967', '551182015967']);
  });
  it('celular BR sem o 9: devolve tambem a forma com o 9', () => {
    expect(phoneVariants('551182015967')).toEqual(['551182015967', '5511982015967']);
  });
  it('fixo BR nao ganha variante', () => {
    expect(phoneVariants('551132015967')).toEqual(['551132015967']);
  });
  it('numero de outro pais nao ganha variante', () => {
    expect(phoneVariants('14155551234')).toEqual(['14155551234']);
  });
});

describe('externalIdVariants', () => {
  it('preserva o sufixo do JID', () => {
    expect(externalIdVariants('5511982015967@s.whatsapp.net')).toEqual([
      '5511982015967@s.whatsapp.net',
      '551182015967@s.whatsapp.net',
    ]);
  });
  it('funciona com id so de digitos (Meta)', () => {
    expect(externalIdVariants('551182015967')).toEqual(['551182015967', '5511982015967']);
  });
  it('nao inventa variante para @lid ou grupo', () => {
    expect(externalIdVariants('123456789@lid')).toEqual(['123456789@lid']);
    expect(externalIdVariants('5511982015967-1600000000@g.us')).toEqual(['5511982015967-1600000000@g.us']);
  });
});
