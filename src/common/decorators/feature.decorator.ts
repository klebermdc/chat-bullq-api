import { SetMetadata } from '@nestjs/common';

export const FEATURE_KEY = 'feature';

/**
 * Amarra o handler (ou o controller inteiro) a uma chave do FEATURE_MAP.
 * O RolesGuard resolve a chave contra o cargo do usuário na org atual.
 */
export const Feature = (feature: string) => SetMetadata(FEATURE_KEY, feature);
