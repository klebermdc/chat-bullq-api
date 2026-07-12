import type { PrismaService } from '../../database/prisma.service';

/**
 * Move (ou cria) o card do lead de uma conversa pra uma etapa do funil de
 * vendas, resolvendo pipeline + etapa por NOME (case-insensitive, "contains").
 *
 * Prisma-direto de propósito: replica o essencial do
 * `PipelinesService.enterStageForConversation` SEM acoplar a cadência, pra
 * evitar o ciclo de módulos (ai-agents → pipelines → cadences → messaging →
 * ai-agents). A cadência por entrada de etapa continua nas transições que
 * passam pelo `PipelinesService.moveCard` (ex.: Proposta enviada).
 *
 * Best-effort: se o pipeline ou a etapa não existirem, não faz nada (o chamador
 * decide se loga). Idempotente: se o card já está na etapa alvo, é no-op.
 *
 * @param stageContains trecho do nome da etapa alvo (ex.: "distribu", "coletando").
 * @param pipelineContains trecho do nome do pipeline (default "vendas").
 * @returns o id da etapa pra qual foi (ou null se não achou pipeline/etapa).
 */
export async function enterLeadStage(
  prisma: PrismaService,
  params: {
    conversationId: string;
    organizationId: string;
    contactId?: string | null;
    stageContains: string;
    pipelineContains?: string;
  },
): Promise<string | null> {
  const {
    conversationId,
    organizationId,
    contactId,
    stageContains,
    pipelineContains = 'vendas',
  } = params;

  const pipeline = await prisma.pipeline.findFirst({
    where: {
      organizationId,
      archived: false,
      name: { contains: pipelineContains, mode: 'insensitive' },
    },
    select: {
      id: true,
      stages: { orderBy: { order: 'asc' }, select: { id: true, name: true } },
    },
  });
  if (!pipeline) return null;

  const target = stageContains.toLowerCase();
  const stage =
    pipeline.stages.find((s) => (s.name ?? '').toLowerCase().includes(target)) ??
    pipeline.stages[0];
  if (!stage) return null;

  const existing = await prisma.card.findFirst({
    where: { pipelineId: pipeline.id, conversationId },
    select: { id: true, stageId: true },
  });
  if (existing?.stageId === stage.id) return stage.id; // já na etapa → no-op

  const maxOrder = await prisma.card.aggregate({
    where: { stageId: stage.id },
    _max: { order: true },
  });
  const order = (maxOrder._max.order ?? -1) + 1;

  if (existing) {
    await prisma.card.update({
      where: { id: existing.id },
      data: { stageId: stage.id, order },
    });
  } else {
    const contact = contactId
      ? await prisma.contact.findUnique({
          where: { id: contactId },
          select: { name: true },
        })
      : null;
    await prisma.card.create({
      data: {
        organizationId,
        pipelineId: pipeline.id,
        stageId: stage.id,
        title: contact?.name || 'Lead SDR',
        conversationId,
        contactId: contactId ?? null,
        order,
      },
    });
  }
  return stage.id;
}
