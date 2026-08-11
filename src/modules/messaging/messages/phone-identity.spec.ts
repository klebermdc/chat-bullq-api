import { phoneVariants } from './phone-identity';

describe('phoneVariants', () => {
  it('casa o mesmo celular com e sem DDI e com e sem o 9º dígito', () => {
    expect(phoneVariants('+55 (11) 98201-5967').sort()).toEqual(
      ['1182015967', '11982015967', '551182015967', '5511982015967'].sort(),
    );
  });

  it('parte do número sem DDI e chega no mesmo conjunto', () => {
    expect(phoneVariants('11982015967').sort()).toEqual(
      ['1182015967', '11982015967', '551182015967', '5511982015967'].sort(),
    );
  });

  it('não inventa 9º dígito em fixo (local não começa em 6-9)', () => {
    expect(phoneVariants('551132015967').sort()).toEqual(
      ['1132015967', '551132015967'].sort(),
    );
  });

  it('devolve vazio quando o telefone não identifica ninguém', () => {
    expect(phoneVariants(null)).toEqual([]);
    expect(phoneVariants(undefined)).toEqual([]);
    expect(phoneVariants('')).toEqual([]);
    expect(phoneVariants('99999')).toEqual([]);
  });

  it('não explode com número internacional fora do padrão brasileiro', () => {
    const variants = phoneVariants('+1 415 555 2671');
    expect(variants).toContain('14155552671');
  });
});
