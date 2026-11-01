import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DIARY_SKILL_CATEGORY } from './diary.constants';
import { DEFAULT_DIARY_CRITERIA } from './diary-default-skills';
import type { DiaryCriterion } from './diary.types';

export interface LoadedCriteria {
  criteria: DiaryCriterion[];
  /** Versão de cada skill usada, para saber sob que regra o dia foi avaliado. */
  versions: Record<string, number>;
}

/** Critérios do diário: skills da categoria, editáveis na tela de Skills. */
@Injectable()
export class DiaryCriteriaService {
  private readonly logger = new Logger(DiaryCriteriaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async loadCriteria(organizationId: string): Promise<LoadedCriteria> {
    await this.ensureDefaults(organizationId);
    const skills = await this.prisma.aiSkill.findMany({
      where: {
        organizationId,
        category: DIARY_SKILL_CATEGORY,
        isActive: true,
        deletedAt: null,
      },
      orderBy: { name: 'asc' },
    });
    const usable = skills.filter((s) => s.promptInstructions?.trim());
    return {
      criteria: usable.map((s) => ({
        name: s.name,
        description: s.description,
        instructions: s.promptInstructions as string,
      })),
      versions: Object.fromEntries(usable.map((s) => [s.name, s.currentVersion])),
    };
  }

  /** Só cria na primeira vez: skill apagada pelo gestor não volta sozinha. */
  private async ensureDefaults(organizationId: string): Promise<void> {
    const existing = await this.prisma.aiSkill.count({
      where: { organizationId, category: DIARY_SKILL_CATEGORY },
    });
    if (existing > 0) return;

    await this.prisma.$transaction(
      DEFAULT_DIARY_CRITERIA.map((criterion) =>
        this.prisma.aiSkill.create({
          data: {
            organizationId,
            name: criterion.name,
            description: criterion.description,
            category: DIARY_SKILL_CATEGORY,
            promptInstructions: criterion.instructions,
            source: 'BUILTIN',
            versions: {
              create: {
                version: 1,
                name: criterion.name,
                description: criterion.description,
                category: DIARY_SKILL_CATEGORY,
                promptInstructions: criterion.instructions,
                source: 'BUILTIN',
                changeNote: 'Critério inicial do diário',
              },
            },
          },
        }),
      ),
    );
    this.logger.log(`diary_default_skills_created org=${organizationId}`);
  }
}
