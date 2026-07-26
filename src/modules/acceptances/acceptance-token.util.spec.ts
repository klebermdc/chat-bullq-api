import { generateAcceptanceToken } from './acceptance-token.util';

describe('generateAcceptanceToken', () => {
  it('gera token url-safe sem padding, >= 40 chars', () => {
    const t = generateAcceptanceToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(t.length).toBeGreaterThanOrEqual(40);
  });

  it('gera valores distintos a cada chamada', () => {
    expect(generateAcceptanceToken()).not.toBe(generateAcceptanceToken());
  });
});
