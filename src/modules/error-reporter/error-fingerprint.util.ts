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

/** Tira do texto tudo que varia entre duas ocorrências do mesmo problema. */
export function normalizeMessage(message: string): string {
  return message
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      '<id>',
    )
    .replace(/\bc[a-z0-9]{24}\b/gi, '<id>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\+?\d{10,15}\b/g, '<phone>')
    .replace(/(https?:\/\/[^\s?]+)\?\S*/gi, '$1')
    .replace(/\b\d{4,}\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Primeiro frame que aponta pro nosso código. Caminho relativo, sem linha. */
export function topProjectFrame(stack?: string): string | null {
  if (!stack) return null;
  for (const line of stack.split('\n')) {
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
