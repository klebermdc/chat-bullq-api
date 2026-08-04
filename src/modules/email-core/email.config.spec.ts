import { loadEmailConfig } from './email.config';

const validEnv = {
  RESEND_API_KEY: 're_test_123',
  RESEND_WEBHOOK_SECRET: 'whsec_dGVzdA==',
  EMAIL_FROM: 'marketing@exemplo.com.br',
  EMAIL_UNSUBSCRIBE_SECRET: 'segredo-longo-o-suficiente',
  APP_PUBLIC_URL: 'https://app.exemplo.com.br',
  API_PUBLIC_URL: 'https://api.exemplo.com.br',
};

describe('loadEmailConfig', () => {
  it('devolve a config quando todas as variáveis existem', () => {
    const cfg = loadEmailConfig(validEnv);
    expect(cfg.from).toBe('marketing@exemplo.com.br');
    expect(cfg.publicUrl).toBe('https://app.exemplo.com.br');
    expect(cfg.apiUrl).toBe('https://api.exemplo.com.br');
  });

  it('remove barra final da URL pública para o link não sair com barra dupla', () => {
    const cfg = loadEmailConfig({ ...validEnv, APP_PUBLIC_URL: 'https://app.exemplo.com.br/' });
    expect(cfg.publicUrl).toBe('https://app.exemplo.com.br');
  });

  it('remove barra final da URL da API para o link não sair com barra dupla', () => {
    const cfg = loadEmailConfig({ ...validEnv, API_PUBLIC_URL: 'https://api.exemplo.com.br/' });
    expect(cfg.apiUrl).toBe('https://api.exemplo.com.br');
  });

  it('explode nomeando a variável que faltou', () => {
    const { RESEND_API_KEY, ...semChave } = validEnv;
    expect(() => loadEmailConfig(semChave)).toThrow(/RESEND_API_KEY/);
  });

  it('explode nomeando API_PUBLIC_URL quando ela falta — web e API são domínios distintos', () => {
    const { API_PUBLIC_URL, ...semApiUrl } = validEnv;
    expect(() => loadEmailConfig(semApiUrl)).toThrow(/API_PUBLIC_URL/);
  });

  it('explode nomeando TODAS as variáveis que faltaram de uma vez', () => {
    expect(() => loadEmailConfig({})).toThrow(/EMAIL_FROM/);
    expect(() => loadEmailConfig({})).toThrow(/APP_PUBLIC_URL/);
    expect(() => loadEmailConfig({})).toThrow(/API_PUBLIC_URL/);
  });

  it('trata string em branco como ausente', () => {
    expect(() => loadEmailConfig({ ...validEnv, EMAIL_FROM: '   ' })).toThrow(/EMAIL_FROM/);
  });
});
