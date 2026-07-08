import { Injectable } from '@nestjs/common';
import { Prisma, Cadence } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { UpsertCadenceDto } from './dto/upsert-cadence.dto';

@Injectable()
export class CadencesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.cadence.findUnique({
      where: { id },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
  }

  /** Cadência habilitada cujo stageId casa com a etapa informada. */
  findByStage(orgId: string, stageId: string) {
    return this.prisma.cadence.findFirst({
      where: { organizationId: orgId, stageId, enabled: true },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
  }

  list(orgId: string) {
    return this.prisma.cadence.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      include: { steps: { orderBy: { order: 'asc' } } },
    });
  }

  /** Upsert da cadência + replace (delete-and-recreate) das etapas, em transação. */
  upsert(orgId: string, dto: UpsertCadenceDto & { id?: string }) {
    return this.prisma.$transaction(async (tx) => {
      let cadence: Cadence;

      if (dto.id) {
        const updateData: Prisma.CadenceUncheckedUpdateInput = {
          name: dto.name,
          pipelineId: dto.pipelineId ?? null,
          stageId: dto.stageId ?? null,
          lostStageId: dto.lostStageId ?? null,
          hotTagId: dto.hotTagId ?? null,
          optOutTagId: dto.optOutTagId ?? null,
          trigger: dto.trigger,
          enabled: dto.enabled,
          allowManual: dto.allowManual,
        };
        cadence = await tx.cadence.update({ where: { id: dto.id }, data: updateData });
        await tx.cadenceStep.deleteMany({ where: { cadenceId: cadence.id } });
      } else {
        const createData: Prisma.CadenceUncheckedCreateInput = {
          organizationId: orgId,
          name: dto.name,
          pipelineId: dto.pipelineId ?? null,
          stageId: dto.stageId ?? null,
          lostStageId: dto.lostStageId ?? null,
          hotTagId: dto.hotTagId ?? null,
          optOutTagId: dto.optOutTagId ?? null,
          trigger: dto.trigger,
          enabled: dto.enabled,
          allowManual: dto.allowManual,
        };
        cadence = await tx.cadence.create({ data: createData });
      }

      if (dto.steps.length > 0) {
        await tx.cadenceStep.createMany({
          data: dto.steps.map(
            (step): Prisma.CadenceStepUncheckedCreateInput => ({
              cadenceId: cadence.id,
              order: step.order,
              delayMinutes: step.delayMinutes,
              content: step.content as Prisma.InputJsonValue,
              options: step.options,
              templateId: step.templateId ?? null,
            }),
          ),
        });
      }

      return tx.cadence.findUnique({
        where: { id: cadence.id },
        include: { steps: { orderBy: { order: 'asc' } } },
      });
    });
  }

  remove(id: string) {
    return this.prisma.cadence.delete({ where: { id } });
  }
}
