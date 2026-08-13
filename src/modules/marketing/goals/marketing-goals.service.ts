import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { HealthGoals } from '../metrics/health-indicators.service';
import { UpsertGoalsDto } from './dto/upsert-goals.dto';

const EMPTY_GOALS: HealthGoals = {
  monthlyBudget: null,
  targetCpl: null,
  targetCtrPct: null,
  targetLeadsPerDay: null,
  targetFrequencyMax: null,
  targetConversionPct: null,
};

interface MarketingGoalRow {
  monthlyBudget: Prisma.Decimal | null;
  targetCpl: Prisma.Decimal | null;
  targetCtrPct: Prisma.Decimal | null;
  targetLeadsPerDay: number | null;
  targetFrequencyMax: Prisma.Decimal | null;
  targetConversionPct: Prisma.Decimal | null;
}

/** Sem `organizationId` de propósito: é gravado à parte no `create`, nunca
 *  no `update` (a chave da linha não muda). Manter os dois separados evita
 *  o spread de `organizationId` colidir com o tipo de `create`. */
interface GoalWriteFields {
  monthlyBudget?: number | null;
  targetCpl?: number | null;
  targetCtrPct?: number | null;
  targetLeadsPerDay?: number | null;
  targetFrequencyMax?: number | null;
  targetConversionPct?: number | null;
}

/**
 * Metas de marketing por organização (`MarketingGoal`, `organizationId`
 * único). "Sem metas configuradas" é um estado normal — a tela de
 * configuração é visitada pela primeira vez sem nada salvo — por isso
 * `get` nunca lança 404, sempre devolve os seis campos (nulos se não
 * houver linha).
 */
@Injectable()
export class MarketingGoalsService {
  constructor(private readonly prisma: PrismaService) {}

  async get(organizationId: string): Promise<HealthGoals> {
    const row = await this.prisma.marketingGoal.findUnique({ where: { organizationId } });
    return row ? this.toView(row) : EMPTY_GOALS;
  }

  /**
   * Grava só os campos presentes no DTO: chave ausente preserva o valor já
   * salvo, `null` explícito apaga a meta daquele campo. Ver comentário em
   * `UpsertGoalsDto` sobre por que essa distinção existe.
   */
  async upsert(organizationId: string, dto: UpsertGoalsDto): Promise<HealthGoals> {
    const data = this.toWriteFields(dto);
    const row = await this.prisma.marketingGoal.upsert({
      where: { organizationId },
      create: { organizationId, ...data },
      update: data,
    });
    return this.toView(row);
  }

  private toWriteFields(dto: UpsertGoalsDto): GoalWriteFields {
    const data: GoalWriteFields = {};
    if (dto.monthlyBudget !== undefined) data.monthlyBudget = dto.monthlyBudget;
    if (dto.targetCpl !== undefined) data.targetCpl = dto.targetCpl;
    if (dto.targetCtrPct !== undefined) data.targetCtrPct = dto.targetCtrPct;
    if (dto.targetLeadsPerDay !== undefined) data.targetLeadsPerDay = dto.targetLeadsPerDay;
    if (dto.targetFrequencyMax !== undefined) data.targetFrequencyMax = dto.targetFrequencyMax;
    if (dto.targetConversionPct !== undefined) data.targetConversionPct = dto.targetConversionPct;
    return data;
  }

  /** Converte `Decimal` para `number` na fronteira — o resto da aplicação só lida com `number`. */
  private toView(row: MarketingGoalRow): HealthGoals {
    return {
      monthlyBudget: row.monthlyBudget === null ? null : Number(row.monthlyBudget),
      targetCpl: row.targetCpl === null ? null : Number(row.targetCpl),
      targetCtrPct: row.targetCtrPct === null ? null : Number(row.targetCtrPct),
      targetLeadsPerDay: row.targetLeadsPerDay,
      targetFrequencyMax: row.targetFrequencyMax === null ? null : Number(row.targetFrequencyMax),
      targetConversionPct: row.targetConversionPct === null ? null : Number(row.targetConversionPct),
    };
  }
}
