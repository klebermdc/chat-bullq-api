import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DEFAULT_MYSTERY_CRITERIA } from './default-criteria';
import { DIARY_SKILL_CATEGORY, MYSTERY_SKILL_CATEGORY, PRODUCT_RULES_SKILL } from './mystery-shopper.constants';
import type { VisitCriterion } from './mystery-shopper.types';

/** Critérios do cliente oculto: skills da categoria, editáveis na tela de Skills. */
@Injectable()
export class MysteryShopperCriteriaService {
  private readonly logger = new Logger(MysteryShopperCriteriaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async loadCriteria(organizationId: string): Promise<VisitCriterion[]> {
    await this.ensureDefaults(organizationId);
    const skills = await this.prisma.aiSkill.findMany({
      where: { organizationId, category: MYSTERY_SKILL_CATEGORY, isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return skills
      .filter((s) => s.promptInstructions?.trim())
      .map((s) => ({ name: s.name, description: s.description ?? s.name, instructions: s.promptInstructions as string }));
  }

  async loadProductRules(organizationId: string): Promise<string | null> {
    const skill = await this.prisma.aiSkill.findFirst({
      where: { organizationId, category: DIARY_SKILL_CATEGORY, name: PRODUCT_RULES_SKILL, isActive: true, deletedAt: null },
      select: { promptInstructions: true },
    });
    return skill?.promptInstructions?.trim() || null;
  }

  /** Só cria na primeira vez: skill apagada pela gestão não volta sozinha. */
  private async ensureDefaults(organizationId: string): Promise<void> {
    const existing = await this.prisma.aiSkill.count({
      where: { organizationId, category: MYSTERY_SKILL_CATEGORY },
    });
    if (existing > 0) return;
    await this.prisma.$transaction(
      DEFAULT_MYSTERY_CRITERIA.map((c) =>
        this.prisma.aiSkill.create({
          data: {
            organizationId,
            name: c.name,
            description: c.description,
            category: MYSTERY_SKILL_CATEGORY,
            promptInstructions: c.instructions,
            source: 'BUILTIN',
            versions: {
              create: {
                version: 1,
                name: c.name,
                description: c.description,
                category: MYSTERY_SKILL_CATEGORY,
                promptInstructions: c.instructions,
                source: 'BUILTIN',
                changeNote: 'Critério inicial do cliente oculto',
              },
            },
          },
        }),
      ),
    );
    this.logger.log(`mystery_default_skills_created org=${organizationId}`);
  }
}
