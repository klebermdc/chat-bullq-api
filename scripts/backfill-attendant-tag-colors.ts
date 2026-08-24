/**
 * Backfill script: dá uma cor distinta pros selos de atendente que ficaram no
 * cinza padrão (#6B7280). Espelha a lógica de `attendantTagColor` do
 * PendingActionService — mesmo atendente (id) → mesma cor, determinístico.
 *
 * Só recolore tags que ainda estão no cinza padrão; nunca sobrescreve uma cor
 * escolhida à mão.
 *
 * Usage:
 *   cd chat-bullq-api
 *   npx ts-node -P tsconfig.json --transpile-only scripts/backfill-attendant-tag-colors.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_TAG_COLOR = '#6B7280';

const ATTENDANT_TAG_COLORS = [
  '#DC2626', // red
  '#EA580C', // orange
  '#CA8A04', // amber
  '#65A30D', // lime
  '#059669', // emerald
  '#0D9488', // teal
  '#0891B2', // cyan
  '#2563EB', // blue
  '#4F46E5', // indigo
  '#7C3AED', // violet
  '#9333EA', // purple
  '#DB2777', // pink
  '#E11D48', // rose
];

function attendantTagColor(key: string): string {
  let hash = 5381;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 33) ^ key.charCodeAt(i);
  }
  const idx = Math.abs(hash) % ATTENDANT_TAG_COLORS.length;
  return ATTENDANT_TAG_COLORS[idx];
}

async function main(): Promise<void> {
  const memberships = await prisma.userOrganization.findMany({
    select: {
      organizationId: true,
      user: { select: { id: true, name: true } },
    },
  });

  let recolored = 0;
  let skipped = 0;

  for (const m of memberships) {
    const name = (m.user.name ?? '').trim();
    if (!name) continue;

    const tag = await prisma.tag.findUnique({
      where: {
        organizationId_name: { organizationId: m.organizationId, name },
      },
      select: { id: true, color: true },
    });
    if (!tag) continue;

    if (tag.color !== DEFAULT_TAG_COLOR) {
      skipped += 1;
      continue;
    }

    const color = attendantTagColor(m.user.id);
    await prisma.tag.update({ where: { id: tag.id }, data: { color } });
    recolored += 1;
    console.log(`recolored "${name}" (org ${m.organizationId}) → ${color}`);
  }

  console.log(`\nDone. recolored=${recolored} skipped(non-gray)=${skipped}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
