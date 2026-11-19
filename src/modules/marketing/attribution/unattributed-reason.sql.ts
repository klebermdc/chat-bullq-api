import { Prisma } from '@prisma/client';
import { touchesCte } from './attribution-touches.sql';

/**
 * Por que uma venda ganha ficou sem anúncio. Ordem = prioridade: a primeira
 * que bater decide.
 *
 * - `ad_without_id`: veio de anúncio (tag "Anúncio Meta", pela frase do
 *   anúncio), mas a Meta não mandou qual — perda real de rastreio.
 * - `organic`: Instagram orgânico (tag ou link da bio no formulário).
 * - `site`: formulário do site sem UTM de anúncio.
 * - `portfolio`: cliente da carteira legada (Umbler) voltando — recompra.
 * - `unknown`: nenhum sinal de origem.
 */
export const UNATTRIBUTED_REASONS = ['ad_without_id', 'organic', 'site', 'portfolio', 'unknown'] as const;
export type UnattributedReason = (typeof UNATTRIBUTED_REASONS)[number];

const TAG_AD = 'Anúncio Meta';
const TAG_ORGANIC = 'Instagram Orgânico';
const TAG_SITE = 'Site';
const ORGANIC_MEDIUM = 'organic';
const PORTFOLIO_ORIGIN_PREFIX = 'umbler%';

function contactHasTag(tagName: string): Prisma.Sql {
  return Prisma.sql`EXISTS (
    SELECT 1 FROM "conversations" cv
    JOIN "conversation_tags" ct ON ct."conversation_id" = cv."id"
    JOIN "tags" tg ON tg."id" = ct."tag_id"
    WHERE cv."contact_id" = w."contact_id" AND tg."name" = ${tagName}
  )`;
}

/** Vendas GANHO do período sem toque de anúncio, agrupadas pelo motivo. */
export function unattributedByReasonSql(organizationId: string, from: Date, to: Date): Prisma.Sql {
  return Prisma.sql`
    WITH ${touchesCte(organizationId)},
    won AS (
      SELECT cd."contact_id", cd."value"
      FROM "cards" cd
      WHERE cd."organization_id" = ${organizationId}
        AND cd."status" = 'WON'
        AND cd."closed_at" >= ${from}
        AND cd."closed_at" <= ${to}
        AND NOT EXISTS (SELECT 1 FROM touches t WHERE t."contact_id" = cd."contact_id")
    )
    SELECT x."reason", COUNT(*)::bigint AS deals, COALESCE(SUM(x."value"), 0) AS revenue
    FROM (
      SELECT w."value",
        CASE
          WHEN ${contactHasTag(TAG_AD)} THEN 'ad_without_id'
          WHEN ${contactHasTag(TAG_ORGANIC)}
            OR EXISTS (SELECT 1 FROM "lead_submissions" ls
                       WHERE ls."contact_id" = w."contact_id"
                         AND ls."attribution"->>'ofp_mdm' = ${ORGANIC_MEDIUM}) THEN 'organic'
          WHEN ${contactHasTag(TAG_SITE)}
            OR EXISTS (SELECT 1 FROM "lead_submissions" ls WHERE ls."contact_id" = w."contact_id") THEN 'site'
          WHEN c."metadata"->>'origem' LIKE ${PORTFOLIO_ORIGIN_PREFIX} THEN 'portfolio'
          ELSE 'unknown'
        END AS reason
      FROM won w
      LEFT JOIN "contacts" c ON c."id" = w."contact_id"
    ) x
    GROUP BY x."reason"
  `;
}
