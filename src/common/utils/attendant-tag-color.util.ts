/**
 * Cor do selo (Tag) de atendente no card da conversa.
 *
 * A etiqueta do atendente é uma Tag de conversa nomeada com o nome do
 * atendente. Por padrão o model Tag nasce cinza (#6B7280), então todos os
 * selos ficavam iguais. Aqui derivamos uma cor estável do id do atendente pra
 * cada um ter a sua — dois caminhos criam esse selo (o assign do FSM e o
 * "Distribuir"), por isso a lógica vive num util compartilhado.
 */

/** Cinza padrão do model Tag — usado só pra detectar selos por recolorir. */
export const DEFAULT_TAG_COLOR = '#6B7280';

/**
 * Paleta de cores distintas (Tailwind 600). Não inclui o cinza padrão de
 * propósito — a graça é cada atendente ter a sua cor.
 */
export const ATTENDANT_TAG_COLORS = [
  '#DC2626', // red
  '#EA580C', // orange
  '#CA8A04', // amber
  '#65A30D', // lime
  '#059669', // emerald
  '#0D9488', // teal
  '#0891B2', // cyan
  '#2563EB', // blue
  '#4F46E5', // indigo
  '#7C3AED', // violet
  '#9333EA', // purple
  '#DB2777', // pink
  '#E11D48', // rose
];

/**
 * Escolhe uma cor estável pra um atendente a partir do id dele. Hash simples
 * (djb2) → índice na paleta; mesmo atendente sempre cai na mesma cor.
 */
export function attendantTagColor(key: string): string {
  let hash = 5381;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 33) ^ key.charCodeAt(i);
  }
  const idx = Math.abs(hash) % ATTENDANT_TAG_COLORS.length;
  return ATTENDANT_TAG_COLORS[idx];
}
