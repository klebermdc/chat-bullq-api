import { Prisma } from '@prisma/client';

/**
 * `Contact.ctwaSourceType` também assume `'post'` (alcance orgânico). Um
 * `ctwaSourceId` de post não é um `adId` — só `'ad'` entra na atribuição.
 */
export const CTWA_SOURCE_TYPE_AD = 'ad';

/** `ofp_mdm` do link da bio do Instagram: lead orgânico, não de anúncio. */
const SITE_ORGANIC_MEDIUM = 'organic';

/** Prefixo do `adId` de um criativo que só conhecemos pela UTM do site. */
export const UTM_AD_ID_PREFIX = 'utm:';

/**
 * CTE `touches`: cada contato que chegou por anúncio, com o momento e o
 * anúncio do toque. Duas fontes:
 *
 * 1. **Click-to-WhatsApp** — `contacts.ctwa_source_id` (referral da Meta).
 * 2. **Formulário do site** — `lead_submissions.attribution` traz a campanha
 *    (`ofp_cmp`), o conjunto (`ofp_trm`) e o criativo (`ofp_cnt`) POR NOME.
 *    O nome vira `ad_id` pelo `ad_daily_stats` (campanha + criativo; empate
 *    decide pelo conjunto e depois pelo maior gasto). Sem par na Meta (conta
 *    não conectada, nome trocado), o toque fica com `ad_id` sintético
 *    `utm:<campanha>|<criativo>` e os nomes da UTM — a venda aparece na
 *    linha da campanha, só sem gasto, em vez de sumir no "não atribuído".
 *
 * Apagados e cliente oculto ficam fora. Toda entrada vem por parâmetro.
 */
export function touchesCte(organizationId: string): Prisma.Sql {
  return Prisma.sql`
    touches AS (
      SELECT c."id" AS contact_id,
             c."ctwa_clid_at" AS at,
             c."ctwa_source_id" AS ad_id,
             NULL::text AS ad_name,
             NULL::text AS campaign_name
      FROM "contacts" c
      WHERE c."organization_id" = ${organizationId}
        AND c."deleted_at" IS NULL
        AND c."is_mystery_shopper" = false
        AND c."ctwa_source_type" = ${CTWA_SOURCE_TYPE_AD}
        AND c."ctwa_source_id" IS NOT NULL
      UNION ALL
      SELECT ls."contact_id",
             ls."created_at",
             COALESCE(
               ad."ad_id",
               ${UTM_AD_ID_PREFIX} || (ls."attribution"->>'ofp_cmp') || '|' || (ls."attribution"->>'ofp_cnt')
             ),
             ls."attribution"->>'ofp_cnt',
             ls."attribution"->>'ofp_cmp'
      FROM "lead_submissions" ls
      JOIN "contacts" c
        ON c."id" = ls."contact_id"
       AND c."deleted_at" IS NULL
       AND c."is_mystery_shopper" = false
      LEFT JOIN LATERAL (
        SELECT a."ad_id"
        FROM "ad_daily_stats" a
        WHERE a."organization_id" = ls."organization_id"
          AND a."campaign_name" = ls."attribution"->>'ofp_cmp'
          AND a."ad_name" = ls."attribution"->>'ofp_cnt'
        GROUP BY a."ad_id"
        ORDER BY COALESCE(bool_or(a."adset_name" = ls."attribution"->>'ofp_trm'), false) DESC,
                 SUM(a."spend") DESC,
                 a."ad_id"
        LIMIT 1
      ) ad ON true
      WHERE ls."organization_id" = ${organizationId}
        AND ls."attribution"->>'ofp_cmp' IS NOT NULL
        AND ls."attribution"->>'ofp_cnt' IS NOT NULL
        AND (ls."attribution"->>'ofp_mdm') IS DISTINCT FROM ${SITE_ORGANIC_MEDIUM}
    )
  `;
}

/**
 * Último toque do contato do card: o mais recente ATÉ o fechamento; se só
 * houver toque depois (clique registrado após o Ganho), usa o mais recente.
 * Card sem contato não tem toque → cai no "não atribuído".
 */
export const LAST_TOUCH_FOR_CARD = Prisma.sql`
  SELECT t."ad_id", t."ad_name", t."campaign_name"
  FROM touches t
  WHERE t."contact_id" = cd."contact_id"
  ORDER BY (t."at" <= cd."closed_at") DESC NULLS LAST, t."at" DESC NULLS LAST
  LIMIT 1
`;
