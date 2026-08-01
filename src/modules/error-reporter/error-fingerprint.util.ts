import { createHash } from 'crypto';
import { ErrorSource } from '@prisma/client';

/**
 * Agrupamento de erros. Duas ocorrências do MESMO problema precisam produzir
 * o mesmo fingerprint, senão o painel vira uma lista de 400 linhas iguais e o
 * alerta do Telegram é silenciado na primeira semana.
 *
 * O frame do projeto entra SEM número de linha de propósito: com a linha,
 * qualquer edição acima da falha criaria um issue novo e você perderia o
 * histórico do bug justamente ao mexer nele.
 */

/**
 * Tetos de tamanho. Existem por causa de ReDoS medido: com a regex de e-mail
 * antiga, 100k caracteres sem "@" travavam o event loop por ~8s. Mensagem de
 * erro aqui pode carregar payload de webhook inteiro, então o teto vem ANTES
 * de qualquer regex. Nada abaixo disso perde informação útil de diagnóstico.
 */
const MESSAGE_MAX = 2000;
const STACK_MAX = 8000;
/** Linha maior que isso não é frame de verdade — é payload colado no stack. */
const STACK_LINE_MAX = 400;

/**
 * Tira do texto tudo que varia entre duas ocorrências do mesmo problema.
 *
 * A ordem importa: timestamp e telefone precisam vir ANTES da regra genérica
 * de dígitos, senão viram `<n>` picado e deixam de agrupar.
 *
 * Casos aceitos como risco conhecido, de propósito:
 *  - SQLSTATE do Postgres (23505 vs 23503) vira `<n>` nos dois. O texto ao
 *    redor difere, então na prática não colide.
 *  - Valor monetário com separador de milhar (R$ 1.234,56) não normaliza.
 *  - Caminho Windows com barra invertida não é reconhecido: só rodamos Linux.
 */
export function normalizeMessage(message: string): string {
  return message
    .slice(0, MESSAGE_MAX)
    .replace(
      /\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:z|[+-]\d{2}:?\d{2})?/gi,
      '<ts>',
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '<id>',
    )
    // Sem flag `i`: cuid é minúsculo. Com ela, qualquer palavra de 25 letras
    // começando com C (ex.: "ConnectionTimeoutExceeded") virava <id>.
    .replace(/\bc[a-z0-9]{24}\b/g, '<id>')
    // Quantificadores limitados: a versão ilimitada fazia backtracking
    // catastrófico em texto longo sem "@".
    .replace(/[\w.+-]{1,64}@[\w-]{1,63}\.[\w.-]{1,63}/g, '<email>')
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '<ip>')
    // Aceita separador entre os grupos: "+55 (11) 99888-7766". Exige no
    // mínimo 11 dígitos, então não engole número de pedido.
    .replace(/\+?\d{1,3}[\s.-]?\(?\d{2,3}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}\b/g, '<phone>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/(https?:\/\/[^\s?]{1,500})\?\S*/gi, '$1')
    .replace(/\b\d{4,}\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Primeiro frame que aponta pro nosso código. Caminho relativo, sem linha. */
export function topProjectFrame(stack?: string): string | null {
  if (!stack) return null;
  for (const line of stack.slice(0, STACK_MAX).split('\n')) {
    if (line.length > STACK_LINE_MAX) continue;
    if (!line.includes('at ')) continue;
    if (line.includes('node_modules')) continue;
    const match = /((?:src|dist)\/[^\s()]+?\.(?:ts|js)):\d+:\d+/.exec(line);
    if (match) return match[1].replace(/^dist\//, 'src/');
  }
  return null;
}

export function buildFingerprint(input: {
  source: ErrorSource;
  code: string;
  message: string;
  stack?: string;
}): string {
  const parts = [
    input.source,
    input.code,
    normalizeMessage(input.message),
    topProjectFrame(input.stack) ?? '',
  ];
  return createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .slice(0, 32);
}
