const DEFAULT_DECIMALS = 4;

/** Arredonda sem carregar o resíduo de ponto flutuante (0,1 × 3 → 0,3). */
export function roundTo(value: number, decimals: number = DEFAULT_DECIMALS): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
