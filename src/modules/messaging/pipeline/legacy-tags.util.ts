const LEGACY_TAG_SEPARATOR = '|';

/**
 * Etiquetas de uma célula da planilha legada ("CRM | Guia" -> ["CRM", "Guia"]).
 * A planilha tem a mesma etiqueta com grafias diferentes ("Guia" e "GUIA"):
 * repetidas ignorando maiúsculas ficam só uma vez, na primeira grafia.
 */
export function parseLegacyTags(raw: string | null): string[] {
  const seen = new Set<string>();
  return (raw ?? '')
    .split(LEGACY_TAG_SEPARATOR)
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLowerCase();
      if (!tag || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
