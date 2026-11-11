/**
 * Espelho de pedidos do HUB (`ofp_sales_orders`) é uma tabela GLOBAL, sem
 * `organizationId`: guarda as vendas de uma única operação. Só a org marcada
 * em `organizations.settings.hubSalesMirror = true` pode ler o espelho.
 * Toda org nova nasce sem a marca, então nada do HUB vaza para ela.
 */
export const HUB_SALES_MIRROR_SETTING = 'hubSalesMirror';

export function hasHubSalesMirror(settings: unknown): boolean {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
  return (settings as Record<string, unknown>)[HUB_SALES_MIRROR_SETTING] === true;
}
