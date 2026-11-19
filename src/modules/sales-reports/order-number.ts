/**
 * O atendente digita o nº do pedido do jeito que quiser ao dar Ganho:
 * "Localizador: R4YB7P", "PEDIDO 78516 just", "79045 JT", "AZUL Localizador:2NM617".
 * O HUB guarda só o código ("R4YB7P", "78516"). Aqui viram candidatos de busca:
 * o texto inteiro (match exato de antes) + cada pedaço com cara de código.
 */

/**
 * Pedaço menor que isso não é código de pedido: corta "JT", "AZUL", "1" e,
 * principalmente, "GUIA" — que é o `pedido` genérico de todo guiamento no HUB
 * e casaria com qualquer card.
 */
const MIN_ORDER_TOKEN_LENGTH = 5;

export function orderNumberCandidates(raw?: string | null): string[] {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return [];

  const tokens = trimmed
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token.length >= MIN_ORDER_TOKEN_LENGTH);

  return Array.from(new Set([trimmed, ...tokens]));
}
