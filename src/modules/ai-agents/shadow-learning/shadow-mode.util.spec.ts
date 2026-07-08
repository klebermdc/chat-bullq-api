import { isShadowMode } from './shadow-mode.util';

describe('isShadowMode', () => {
  it('true só para SHADOW', () => {
    expect(isShadowMode('SHADOW')).toBe(true);
    expect(isShadowMode('AUTONOMOUS')).toBe(false);
    expect(isShadowMode('COPILOT')).toBe(false);
    expect(isShadowMode(null)).toBe(false);
    expect(isShadowMode(undefined)).toBe(false);
  });
});
