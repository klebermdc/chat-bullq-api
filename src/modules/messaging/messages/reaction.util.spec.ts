import { isSingleEmoji } from './reaction.util';

describe('isSingleEmoji', () => {
  it('aceita emoji simples', () => {
    expect(isSingleEmoji('👍')).toBe(true);
  });

  it('aceita emoji composto por ZWJ (família, profissões)', () => {
    expect(isSingleEmoji('👩‍💻')).toBe(true);
  });

  it('aceita emoji com modificador de tom de pele', () => {
    expect(isSingleEmoji('👍🏽')).toBe(true);
  });

  it('recusa dois emojis', () => {
    expect(isSingleEmoji('👍👎')).toBe(false);
  });

  it('recusa texto', () => {
    expect(isSingleEmoji('oi')).toBe(false);
  });

  it('recusa letra única (é um grafema, mas não é emoji)', () => {
    expect(isSingleEmoji('a')).toBe(false);
  });

  it('recusa string vazia', () => {
    expect(isSingleEmoji('')).toBe(false);
  });
});
