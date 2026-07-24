import {
  attendantTagColor,
  ATTENDANT_TAG_COLORS,
  DEFAULT_TAG_COLOR,
} from './attendant-tag-color.util';

describe('attendantTagColor', () => {
  it('é determinístico: mesmo id → mesma cor', () => {
    expect(attendantTagColor('user-123')).toBe(attendantTagColor('user-123'));
  });

  it('sempre retorna uma cor da paleta', () => {
    for (const id of ['a', 'user-1', 'cmr2u4a5g0001', '', 'áçõ']) {
      expect(ATTENDANT_TAG_COLORS).toContain(attendantTagColor(id));
    }
  });

  it('nunca retorna o cinza padrão', () => {
    expect(ATTENDANT_TAG_COLORS).not.toContain(DEFAULT_TAG_COLOR);
    for (const id of ['x', 'y', 'z', 'barbara', 'pedro', 'renata']) {
      expect(attendantTagColor(id)).not.toBe(DEFAULT_TAG_COLOR);
    }
  });

  it('distribui ids diferentes por cores diferentes (não tudo na mesma)', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `user-${i}`);
    const distinct = new Set(ids.map(attendantTagColor));
    expect(distinct.size).toBeGreaterThan(1);
  });
});
