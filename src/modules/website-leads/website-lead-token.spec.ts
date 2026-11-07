import { generateLeadToken, hashLeadToken, previewLeadToken, webhookPath } from './website-lead-token';

describe('token do webhook do site', () => {
  it('gera tokens diferentes, com prefixo e sem caracteres que quebram URL', () => {
    const a = generateLeadToken();
    const b = generateLeadToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^wl_[A-Za-z0-9_-]{40,}$/);
  });

  it('hash é estável e não contém o token', () => {
    const t = generateLeadToken();
    expect(hashLeadToken(t)).toBe(hashLeadToken(` ${t} `));
    expect(hashLeadToken(t)).not.toContain(t);
    expect(hashLeadToken(t)).toHaveLength(64);
  });

  it('preview mostra só o fim', () => {
    expect(previewLeadToken('wl_abcdefXYZW')).toBe('wl_…XYZW');
  });

  it('monta o caminho com o token e, no guiamento, o form', () => {
    expect(webhookPath('wl_x')).toBe('/api/v1/public/leads/website?token=wl_x');
    expect(webhookPath('wl_x', 'guiamento')).toBe('/api/v1/public/leads/website?token=wl_x&form=guiamento');
  });
});
