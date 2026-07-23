/**
 * Adiciona a etapa "Não respondeu" no FIM do pipeline "Vendas OFP" de uma org
 * (idempotente — se já existir uma etapa com esse nome, não faz nada).
 *
 * Roda no MAC (não na VPS), direto via Prisma:
 *   DATABASE_URL=postgres://... ORG_ID=<org> \
 *     npx ts-node -P tsconfig.json --transpile-only scripts/seed-nao-respondeu-stage.ts
 *
 * Opcional: PIPELINE_NAME (default "Vendas OFP", match por contains,
 * case-insensitive) e STAGE_NAME (default "Não respondeu").
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PIPELINE_MATCH = process.env.PIPELINE_NAME || 'Vendas OFP';
const STAGE_NAME = process.env.STAGE_NAME || 'Não respondeu';

async function main() {
  const orgId = (process.env.ORG_ID || '').trim();
  if (!orgId) throw new Error('ORG_ID obrigatório.');

  const pipeline = await prisma.pipeline.findFirst({
    where: {
      organizationId: orgId,
      name: { contains: PIPELINE_MATCH, mode: 'insensitive' },
    },
    include: { stages: { orderBy: { order: 'asc' } } },
  });
  if (!pipeline) {
    throw new Error(
      `Pipeline contendo "${PIPELINE_MATCH}" não encontrado na org ${orgId}.`,
    );
  }
  console.log(`Pipeline: "${pipeline.name}" (${pipeline.id}).`);

  const already = pipeline.stages.find((s) =>
    s.name.toLowerCase().includes(STAGE_NAME.toLowerCase()),
  );
  if (already) {
    console.log(`Etapa "${already.name}" já existe (${already.id}) — nada a fazer.`);
    return;
  }

  const maxOrder = pipeline.stages.reduce((m, s) => Math.max(m, s.order), -1);
  const stage = await prisma.pipelineStage.create({
    data: {
      pipelineId: pipeline.id,
      name: STAGE_NAME,
      order: maxOrder + 1,
    },
  });
  console.log(
    `Criada etapa "${STAGE_NAME}" (${stage.id}), order=${stage.order}, no pipeline "${pipeline.name}".`,
  );
}

main()
  .catch((e) => {
    console.error('Falhou:', e.message || e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
