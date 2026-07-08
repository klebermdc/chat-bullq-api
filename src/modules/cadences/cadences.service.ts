import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CadenceTrigger } from '@prisma/client';
import { CadencesRepository } from './cadences.repository';
import { CADENCE_DEFAULT_STEPS } from './cadences.constants';
import { UpsertCadenceDto } from './dto/upsert-cadence.dto';

@Injectable()
export class CadencesService {
  constructor(private readonly repo: CadencesRepository) {}

  /**
   * Cadência NÃO persistida, semeada com os 4 textos padrão, para o editor web
   * partir de um estado inicial. `id: null` sinaliza que ainda não existe no banco.
   */
  getDefaultTemplate(orgId?: string) {
    return {
      id: null as string | null,
      organizationId: orgId ?? null,
      name: 'Cadência de negociação',
      pipelineId: null as string | null,
      stageId: null as string | null,
      lostStageId: null as string | null,
      hotTagId: null as string | null,
      optOutTagId: null as string | null,
      trigger: CadenceTrigger.BOTH,
      enabled: false,
      allowManual: true,
      isTemplate: true,
      steps: CADENCE_DEFAULT_STEPS.map((s) => ({
        order: s.order,
        delayHours: s.delayHours,
        content: { text: s.text },
        options: [...s.options],
        templateId: null as string | null,
      })),
    };
  }

  /**
   * Sem `id`: retorna a cadência persistida do org (a primeira) ou, se não houver
   * nenhuma, o template padrão não-persistido.
   * Com `id`: carrega a cadência, validando existência e posse pelo org.
   */
  async get(orgId: string, id?: string) {
    if (id) {
      const cadence = await this.repo.findById(id);
      if (!cadence) {
        throw new NotFoundException('Cadência não encontrada');
      }
      if (cadence.organizationId !== orgId) {
        throw new ForbiddenException('Cadência de outra organização');
      }
      return cadence;
    }

    const cadences = await this.repo.list(orgId);
    if (cadences.length === 0) {
      return this.getDefaultTemplate(orgId);
    }
    return cadences[0];
  }

  list(orgId: string) {
    return this.repo.list(orgId);
  }

  async upsert(orgId: string, dto: UpsertCadenceDto, id?: string) {
    if (id) {
      const existing = await this.repo.findById(id);
      if (!existing) {
        throw new NotFoundException('Cadência não encontrada');
      }
      if (existing.organizationId !== orgId) {
        throw new ForbiddenException('Cadência de outra organização');
      }
    }

    const steps = this.validateAndSortSteps(dto.steps);
    return this.repo.upsert(orgId, { ...dto, steps, id });
  }

  async remove(orgId: string, id: string) {
    const existing = await this.repo.findById(id);
    if (!existing) {
      throw new NotFoundException('Cadência não encontrada');
    }
    if (existing.organizationId !== orgId) {
      throw new ForbiddenException('Cadência de outra organização');
    }
    return this.repo.remove(id);
  }

  private validateAndSortSteps(steps: UpsertCadenceDto['steps']) {
    if (!steps || steps.length === 0) {
      throw new BadRequestException('A cadência precisa de ao menos 1 etapa');
    }

    const orders = new Set<number>();
    for (const step of steps) {
      if (step.delayHours <= 0) {
        throw new BadRequestException('delayHours deve ser maior que 0');
      }
      if (orders.has(step.order)) {
        throw new BadRequestException(`order duplicado: ${step.order}`);
      }
      orders.add(step.order);
    }

    return [...steps].sort((a, b) => a.order - b.order);
  }
}
