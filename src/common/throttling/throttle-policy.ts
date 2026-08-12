/**
 * Rotas fora do rate limit.
 *
 * O limite existe para fechar força bruta no login — antes disto NÃO havia
 * limite em endpoint nenhum da API. Mas limite global sem exceção quebra o
 * atendimento em três lugares, e nos três a falha é silenciosa:
 *
 *   - webhook de entrada: a Meta reenvia em rajada e não distingue 429 de
 *     erro nosso. Webhook recusado = mensagem de cliente perdida;
 *   - health: o monitor externo bate sempre do mesmo IP, de minuto em minuto;
 *   - leitura de mídia: abrir uma conversa cheia de anexo dispara dezenas de
 *     GETs juntos, e é por essa rota que a própria Meta baixa a mídia que
 *     estamos enviando.
 *
 * Denylist e não allowlist, ao contrário do `public-key.util`: aqui o padrão
 * seguro é LIMITAR, então rota nova nasce limitada. É o inverso do storage,
 * onde o padrão seguro é negar.
 */
const ROTAS_SEM_LIMITE = [
  '/api/v1/webhooks/',
  '/api/v1/health',
  '/api/v1/uploads/',
] as const;

/** A rota deve escapar do rate limit? Recebe o path cru da requisição. */
export function shouldSkipThrottle(url: string): boolean {
  const caminho = url.split('?')[0];
  return ROTAS_SEM_LIMITE.some((rota) =>
    // A barra final nos prefixos evita casar `webhooksX/`; o `/health` não tem
    // filho, então casa exato — senão `/healthzinho` escaparia junto.
    rota.endsWith('/') ? caminho.startsWith(rota) : caminho === rota,
  );
}
