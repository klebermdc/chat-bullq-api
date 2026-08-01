/**
 * Oculta segredo antes do contexto do erro virar linha no banco e mensagem
 * no Telegram.
 *
 * Existe porque confiar em cada ponto de coleta lembrar de não vazar não
 * funciona: o `locator` do adapter Zappfy carrega o token vivo do webhook, e
 * ele ia parar no painel. A redação é central de propósito — todo coletor,
 * inclusive os que ainda não existem, passa por aqui.
 *
 * A chave é ocultada pelo NOME, não pelo formato do valor: é o único critério
 * que continua valendo quando um provedor novo inventa outro formato de token.
 */
const CHAVE_SENSIVEL =
  /(token|secret|senha|password|authorization|api[-_]?key|apikey|credential|cookie|bearer|assinatura|signature)/i;

/**
 * JID do WhatsApp (`5511999998888@s.whatsapp.net`) carrega o telefone do
 * cliente. Ocultar por NOME de chave não pega este caso — o campo se chama
 * `externalConversationId`, que não parece segredo nenhum. Então este é o
 * único valor que também é filtrado pelo formato.
 */
const JID_WHATSAPP = /\b\d{6,}(?=@)/g;

const VALOR_OCULTO = '<oculto>';
/** Contexto de erro é raso por natureza; abaixo disso não há diagnóstico. */
const PROFUNDIDADE_MAX = 5;

export function redactSecrets(valor: unknown): unknown {
  return percorre(valor, 0, new WeakSet());
}

function percorre(
  valor: unknown,
  profundidade: number,
  vistos: WeakSet<object>,
): unknown {
  if (typeof valor === 'string') return valor.replace(JID_WHATSAPP, '<telefone>');
  if (valor === null || typeof valor !== 'object') return valor;
  if (profundidade >= PROFUNDIDADE_MAX) return '<profundo demais>';
  // Referência circular: sem isto, um objeto que aponta pra si mesmo
  // travaria o processo dentro de um handler de erro.
  if (vistos.has(valor)) return '<circular>';
  vistos.add(valor);

  if (Array.isArray(valor)) {
    return valor.map((item) => percorre(item, profundidade + 1, vistos));
  }

  const saida: Record<string, unknown> = {};
  for (const [chave, item] of Object.entries(valor as Record<string, unknown>)) {
    saida[chave] = CHAVE_SENSIVEL.test(chave)
      ? VALOR_OCULTO
      : percorre(item, profundidade + 1, vistos);
  }
  return saida;
}

/**
 * Redação de TEXTO LIVRE — mensagem de erro e stack.
 *
 * `redactSecrets` oculta pelo NOME da chave, o que não serve aqui: o
 * `err.message` que vem do Prisma, do axios ou do cliente de LLM é texto
 * corrido, sem chave nenhuma. Então este redator trabalha por FORMATO, e só
 * com formatos distintivos o bastante para não estragar o diagnóstico.
 *
 * A ordem importa: a regra de `Bearer` vem antes da regra de chave=valor,
 * senão a segunda comeria a palavra "Bearer" e deixaria o token exposto.
 */
const TEXTO_SENSIVEL: Array<[RegExp, string]> = [
  // Credencial embutida em URL: postgresql://usuario:senha@host
  [/(\/\/)[^\s:@/]+:[^\s@/]+@/g, '$1<oculto>@'],
  // Authorization: Bearer <token> / Basic <credencial>
  [/((?:bearer|basic)\s+)[\w.\-+/=]+/gi, '$1<oculto>'],
  // token=abc, "apiKey": "xyz", secret: 123
  [
    /((?:token|secret|senha|password|api[-_]?key|apikey|credential)["']?\s*[:=]\s*["']?)([^\s"',;&)]+)/gi,
    '$1<oculto>',
  ],
  // JID do WhatsApp carrega o telefone do cliente
  [/\b\d{6,}(?=@)/g, '<telefone>'],
];

/** Aplica as regras de formato a um texto livre. Nunca lança. */
export function redactText(texto: string): string {
  return TEXTO_SENSIVEL.reduce(
    (acc, [padrao, substituto]) => acc.replace(padrao, substituto),
    texto,
  );
}
