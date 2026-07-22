import { SetMetadata } from '@nestjs/common';
import type { FeatureKey } from '../rbac/feature-map';

export const FEATURE_KEY = 'feature';

/**
 * Amarra o handler (ou o controller inteiro) a uma chave do FEATURE_MAP.
 * O RolesGuard resolve a chave contra o cargo do usuário na org atual.
 *
 * Parâmetro tipado como `FeatureKey` (união literal das chaves do
 * FEATURE_MAP) — um typo tipo `@Feature('pipeline.manage')` (falta o "s")
 * agora quebra o build em vez de compilar e devolver 403 silencioso pra
 * todo mundo em runtime. `import type` evita puxar código de `common/rbac`
 * pro grafo de módulos de `common/decorators` — só o tipo atravessa.
 */
export const Feature = (feature: FeatureKey) => SetMetadata(FEATURE_KEY, feature);
