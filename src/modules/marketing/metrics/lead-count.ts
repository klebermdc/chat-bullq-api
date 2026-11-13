import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { NOT_MYSTERY_SHOPPER_CONTACT } from '../../../common/mystery-shopper.filters';

/**
 * Contato criado por script de importação não é lead do período.
 *
 * Só os scripts de carga (carteira Umbler: 'umbler', caixas: 'umbler_caixa')
 * gravam `metadata.origem`. Esses contatos nascem com `created_at` = dia da
 * carga — em 07/11/2026 foram 8.085 de uma vez, e o painel de Marketing
 * mostrou ~8,5 mil leads no mês quando os reais eram ~400.
 *
 * Fragmento para usar dentro de um WHERE sobre `contacts`, sem alias.
 */
export const NOT_IMPORTED_CONTACT = Prisma.sql`"metadata"->>'origem' IS NULL`;

/** Leads (contatos que chegaram) no período. Mesma regra do gráfico diário. */
export async function countLeads(
  prisma: PrismaService,
  organizationId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ leads: bigint }>>(
    Prisma.sql`
      SELECT COUNT(*)::bigint AS leads
      FROM "contacts"
      WHERE "organization_id" = ${organizationId}
        AND "deleted_at" IS NULL
        AND "created_at" >= ${from}
        AND "created_at" <= ${to}
        AND ${NOT_IMPORTED_CONTACT}
        AND ${NOT_MYSTERY_SHOPPER_CONTACT}
    `,
  );
  return rows.length > 0 ? Number(rows[0].leads) : 0;
}
