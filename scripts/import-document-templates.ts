export {}; // isola o escopo do módulo

/**
 * Importa modelos de documento (contratos com `[Campo]`) para UMA org.
 *
 * O texto dos modelos é material licenciado: fica num JSON FORA do repositório
 * e entra só por este script, nunca por seed/migração. O script nunca imprime
 * o corpo dos modelos — só título, categoria, tamanho e nº de campos.
 *
 * JSON: { "templates": [{ "sourceRef", "title", "category", "audience": "CLIENT"|"INTERNAL", "body" }] }
 * `sourceRef` = id do arquivo de origem (Drive). Idempotente: upsert por
 * (organizationId, sourceRef). Na atualização, `isActive` não é tocado — um
 * modelo desativado pelo admin continua desativado.
 *
 *   TEMPLATES_FILE=/caminho/modelos.json ORG_ID=<id da org> \
 *     npx ts-node scripts/import-document-templates.ts
 *
 * DRY-RUN por padrão (mostra o que seria criado/atualizado). Para gravar: APPLY=1.
 * Usa DATABASE_URL do ambiente (rodar onde a API roda).
 */
import { readFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import {
  ImportTemplate,
  parseImportFile,
} from '../src/modules/document-templates/template-import.util';
import { extractPlaceholders } from '../src/modules/document-templates/placeholders.util';

const APPLY = process.env.APPLY === '1' || process.env.APPLY === 'true';

type Action = 'criar' | 'atualizar' | 'igual';

function describe(t: ImportTemplate, action: Action): string {
  const fields = extractPlaceholders(t.body).length;
  return `${action.padEnd(9)} ${t.audience.padEnd(8)} ${JSON.stringify(t.category)} / ${JSON.stringify(t.title)} (${t.body.length} caracteres, ${fields} campos) [${t.sourceRef}]`;
}

function readInput(): { file: string; orgId: string } {
  const file = process.env.TEMPLATES_FILE?.trim();
  const orgId = process.env.ORG_ID?.trim();
  if (!file || !orgId) {
    throw new Error('Defina TEMPLATES_FILE (caminho do JSON) e ORG_ID.');
  }
  return { file, orgId };
}

async function actionFor(prisma: PrismaClient, orgId: string, t: ImportTemplate): Promise<Action> {
  const existing = await prisma.documentTemplate.findUnique({
    where: { organizationId_sourceRef: { organizationId: orgId, sourceRef: t.sourceRef } },
    select: { title: true, category: true, audience: true, body: true },
  });
  if (!existing) return 'criar';
  const same = existing.title === t.title && existing.category === t.category
    && existing.audience === t.audience && existing.body === t.body;
  return same ? 'igual' : 'atualizar';
}

async function upsert(prisma: PrismaClient, orgId: string, t: ImportTemplate): Promise<void> {
  const fields = { title: t.title, category: t.category, audience: t.audience, body: t.body };
  await prisma.documentTemplate.upsert({
    where: { organizationId_sourceRef: { organizationId: orgId, sourceRef: t.sourceRef } },
    create: { organizationId: orgId, sourceRef: t.sourceRef, ...fields },
    update: fields,
  });
}

async function main(): Promise<void> {
  const { file, orgId } = readInput();
  const { templates, errors } = parseImportFile(JSON.parse(readFileSync(file, 'utf8')));
  if (errors.length > 0) {
    console.error(`Arquivo inválido (${errors.length} erro(s)) — nada foi gravado:`);
    errors.forEach((e) => console.error(`  - ${e}`));
    process.exitCode = 1;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } });
    if (!org) throw new Error(`Organização ${orgId} não encontrada.`);
    console.log(`${APPLY ? 'GRAVANDO' : 'DRY-RUN'} — ${templates.length} modelo(s) para ${JSON.stringify(org.name)}`);

    const counts: Record<Action, number> = { criar: 0, atualizar: 0, igual: 0 };
    for (const t of templates) {
      const action = await actionFor(prisma, orgId, t);
      counts[action] += 1;
      console.log(`  ${describe(t, action)}`);
      if (APPLY && action !== 'igual') await upsert(prisma, orgId, t);
    }
    console.log(`Resumo: ${counts.criar} criar, ${counts.atualizar} atualizar, ${counts.igual} sem mudança.`);
    if (!APPLY) console.log('Nada foi gravado. Para gravar: APPLY=1.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
