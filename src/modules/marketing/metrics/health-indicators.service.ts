import { Injectable } from '@nestjs/common';
import { BUDGET_PACE_TOLERANCE_PP, GOAL_TOLERANCE_PCT } from '../marketing.constants';

export type TrafficLight = 'green' | 'yellow' | 'red' | 'grey';

export interface HealthIndicator {
  key: string;
  label: string;
  value: number | null;
  target: number | null;
  color: TrafficLight;
  format: 'currency' | 'percent' | 'number';
}

export interface HealthGoals {
  targetCpl: number | null;
  targetCtrPct: number | null;
  targetLeadsPerDay: number | null;
  targetFrequencyMax: number | null;
  targetConversionPct: number | null;
  monthlyBudget: number | null;
}

export interface HealthInput {
  cpl: number | null;
  ctrPct: number | null;
  leadsPerDay: number | null;
  frequency: number | null;
  conversionPct: number | null;
  budgetPace: { spentPct: number; timePct: number } | null;
  goals: HealthGoals | null;
}

type Direction = 'lowerIsBetter' | 'higherIsBetter';

/**
 * Farol de um indicador comum (todos menos o ritmo de gasto, que tem regra
 * própria). Alvo nulo é sempre cinza — nunca vermelho por falta de
 * configuração, um painel sem metas gritando vermelho ensina as pessoas a
 * ignorar o farol. Valor nulo (não computável, ex.: divisão por zero, sem
 * dado no período) também é sempre cinza, nunca vermelho.
 */
function goalColor(value: number | null, target: number | null, direction: Direction): TrafficLight {
  if (target === null) return 'grey';
  if (value === null) return 'grey';

  const toleranceFactor = GOAL_TOLERANCE_PCT / 100;

  if (direction === 'lowerIsBetter') {
    if (value <= target) return 'green';
    if (value <= target * (1 + toleranceFactor)) return 'yellow';
    return 'red';
  }

  if (value >= target) return 'green';
  if (value >= target * (1 - toleranceFactor)) return 'yellow';
  return 'red';
}

/**
 * Ritmo de gasto não segue a regra de tolerância relativa acima: compara o
 * percentual gasto do orçamento com o percentual do mês já decorrido, em
 * pontos percentuais, e não tem estado amarelo.
 */
function budgetPaceColor(
  monthlyBudget: number | null,
  budgetPace: { spentPct: number; timePct: number } | null,
): TrafficLight {
  if (monthlyBudget === null || monthlyBudget === 0) return 'grey';
  if (budgetPace === null) return 'grey';

  const paceDiffPp = budgetPace.spentPct - budgetPace.timePct;
  return paceDiffPp > BUDGET_PACE_TOLERANCE_PP ? 'red' : 'green';
}

@Injectable()
export class HealthIndicatorsService {
  /**
   * Sempre devolve os seis indicadores, sempre nesta ordem, mesmo quando
   * `goals` é nulo por inteiro — a grade do painel na tela não pode mudar de
   * tamanho conforme a configuração da organização.
   */
  buildIndicators(input: HealthInput): HealthIndicator[] {
    const goals = input.goals;

    return [
      {
        key: 'cpl',
        label: 'Custo por lead',
        value: input.cpl,
        target: goals?.targetCpl ?? null,
        color: goalColor(input.cpl, goals?.targetCpl ?? null, 'lowerIsBetter'),
        format: 'currency',
      },
      {
        key: 'ctrPct',
        label: 'CTR',
        value: input.ctrPct,
        target: goals?.targetCtrPct ?? null,
        color: goalColor(input.ctrPct, goals?.targetCtrPct ?? null, 'higherIsBetter'),
        format: 'percent',
      },
      {
        key: 'leadsPerDay',
        label: 'Leads por dia',
        value: input.leadsPerDay,
        target: goals?.targetLeadsPerDay ?? null,
        color: goalColor(input.leadsPerDay, goals?.targetLeadsPerDay ?? null, 'higherIsBetter'),
        format: 'number',
      },
      {
        key: 'frequency',
        label: 'Frequência',
        value: input.frequency,
        target: goals?.targetFrequencyMax ?? null,
        color: goalColor(input.frequency, goals?.targetFrequencyMax ?? null, 'lowerIsBetter'),
        format: 'number',
      },
      {
        key: 'conversionPct',
        label: 'Taxa de conversão',
        value: input.conversionPct,
        target: goals?.targetConversionPct ?? null,
        color: goalColor(input.conversionPct, goals?.targetConversionPct ?? null, 'higherIsBetter'),
        format: 'percent',
      },
      {
        key: 'budgetPace',
        label: 'Ritmo de gasto',
        value: input.budgetPace?.spentPct ?? null,
        target: input.budgetPace?.timePct ?? null,
        color: budgetPaceColor(goals?.monthlyBudget ?? null, input.budgetPace),
        format: 'percent',
      },
    ];
  }
}
