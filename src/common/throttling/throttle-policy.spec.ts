import { shouldSkipThrottle } from './throttle-policy';

/**
 * O rate limit é a primeira defesa contra força bruta no login — não existia
 * nada, em endpoint nenhum. Mas ligar um limite global sem exceção quebra o
 * atendimento: webhook da Meta chega em rajada e mensagem descartada é
 * mensagem de cliente perdida, em silêncio.
 *
 * Esta política é a lista do que NÃO pode ser limitado.
 */
describe('shouldSkipThrottle', () => {
  it.each([
    '/api/v1/webhooks/WHATSAPP_OFFICIAL/canal-1',
    '/api/v1/webhooks/kirvano/segredo',
    '/api/v1/webhooks/email/resend',
  ])('não limita webhook de entrada: %s', (rota) => {
    // A Meta reenvia em rajada e não distingue 429 de erro nosso: um webhook
    // recusado vira mensagem de cliente perdida.
    expect(shouldSkipThrottle(rota)).toBe(true);
  });

  it('não limita o health check', () => {
    // O monitor externo bate de minuto em minuto e sempre do mesmo IP.
    expect(shouldSkipThrottle('/api/v1/health')).toBe(true);
  });

  it('não limita a leitura de mídia', () => {
    // Abrir uma conversa com muito anexo dispara dezenas de GETs de uma vez —
    // e é a Meta que busca a mídia que estamos enviando.
    expect(shouldSkipThrottle('/api/v1/uploads/media/2026-08-12/foto.jpg')).toBe(
      true,
    );
  });

  it.each([
    '/api/v1/auth/login',
    '/api/v1/conversations',
    '/api/v1/acceptances/abc/pdf',
  ])('limita o resto: %s', (rota) => {
    expect(shouldSkipThrottle(rota)).toBe(false);
  });

  it('não deixa prefixo passar por semelhança de nome', () => {
    // `/healthzinho` não é `/health`; `webhooksX` não é `webhooks/`.
    expect(shouldSkipThrottle('/api/v1/healthzinho')).toBe(false);
    expect(shouldSkipThrottle('/api/v1/webhooksX/y')).toBe(false);
  });

  it('ignora query string ao decidir', () => {
    expect(shouldSkipThrottle('/api/v1/health?verbose=1')).toBe(true);
  });
});
