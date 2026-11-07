/** Chaves canônicas de origem de lead. AD/SITE são reservadas p/ CTWA/Site (futuro). */
export type LeadOriginKey = 'INSTAGRAM_ORGANIC' | 'AD' | 'SITE';

/** Nome da tag de conversa que representa cada origem. Fonte única da verdade. */
export const ORIGIN_TAG_NAMES: Record<LeadOriginKey, string> = {
  INSTAGRAM_ORGANIC: 'Instagram Orgânico',
  // A mesma do CTWA automático: o seletor manual não pode criar outra tag.
  AD: 'Anúncio Meta',
  SITE: 'Site',
};

/** Nome que o seletor manual usava antes; ainda existe em conversas antigas. */
const LEGACY_AD_TAG_NAME = 'Anúncio';

/** Todos os nomes de tag que representam origem (para limpar ao trocar). */
export const ALL_ORIGIN_TAG_NAMES: string[] = [
  ...Object.values(ORIGIN_TAG_NAMES),
  LEGACY_AD_TAG_NAME,
];
