import { HealthGoals, HealthIndicatorsService, HealthInput } from './health-indicators.service';

/** Metas com tudo preenchido, para os testes de cor que não mexem em `goals`. */
const FULL_GOALS: HealthGoals = {
  targetCpl: 12,
  targetCtrPct: 2,
  targetLeadsPerDay: 10,
  targetFrequencyMax: 3,
  targetConversionPct: 20,
  monthlyBudget: 10000,
};

/** Base com todas as métricas computadas e metas cheias, para editar campo a campo por teste. */
function buildInput(overrides: Partial<HealthInput> = {}): HealthInput {
  return {
    cpl: 10,
    ctrPct: 3,
    leadsPerDay: 15,
    frequency: 2,
    conversionPct: 25,
    budgetPace: { spentPct: 50, timePct: 50 },
    goals: FULL_GOALS,
    ...overrides,
  };
}

const KEY_ORDER = ['cpl', 'ctrPct', 'leadsPerDay', 'frequency', 'conversionPct', 'budgetPace'];

describe('HealthIndicatorsService', () => {
  let service: HealthIndicatorsService;

  beforeEach(() => {
    service = new HealthIndicatorsService();
  });

  it('sempre devolve exatamente seis indicadores, na mesma ordem', () => {
    const indicators = service.buildIndicators(buildInput());
    expect(indicators).toHaveLength(6);
    expect(indicators.map((i) => i.key)).toEqual(KEY_ORDER);
  });

  it('mantem a mesma ordem mesmo com goals nulo, para a grade nao mudar de tamanho', () => {
    const indicators = service.buildIndicators(buildInput({ goals: null }));
    expect(indicators).toHaveLength(6);
    expect(indicators.map((i) => i.key)).toEqual(KEY_ORDER);
  });

  describe('meta nula nunca vira vermelho', () => {
    it('fica cinza em cada indicador quando o alvo correspondente e nulo, mesmo com valor presente', () => {
      const goalsAllNull: HealthGoals = {
        targetCpl: null,
        targetCtrPct: null,
        targetLeadsPerDay: null,
        targetFrequencyMax: null,
        targetConversionPct: null,
        monthlyBudget: null,
      };
      const indicators = service.buildIndicators(buildInput({ goals: goalsAllNull }));
      // Nenhum vermelho por falta de configuracao: um painel sem metas gritando
      // vermelho ensina as pessoas a ignorar o farol.
      expect(indicators.every((i) => i.color === 'grey')).toBe(true);
    });

    it('devolve os seis indicadores cinza quando goals e nulo por inteiro', () => {
      const indicators = service.buildIndicators(buildInput({ goals: null }));
      expect(indicators.every((i) => i.color === 'grey')).toBe(true);
    });
  });

  describe('valor nao computavel (null) nunca vira vermelho', () => {
    it('CPL fica cinza com value null mesmo tendo meta configurada', () => {
      const [cpl] = service.buildIndicators(buildInput({ cpl: null }));
      expect(cpl.value).toBeNull();
      expect(cpl.color).toBe('grey');
    });

    it('CTR fica cinza com value null mesmo tendo meta configurada', () => {
      const [, ctr] = service.buildIndicators(buildInput({ ctrPct: null }));
      expect(ctr.value).toBeNull();
      expect(ctr.color).toBe('grey');
    });
  });

  describe('CPL (menor e melhor, alvo 12)', () => {
    it('value 10 (abaixo do alvo) fica verde', () => {
      const [cpl] = service.buildIndicators(buildInput({ cpl: 10 }));
      expect(cpl.color).toBe('green');
    });

    it('value 12 (igual ao alvo, fronteira) fica verde', () => {
      const [cpl] = service.buildIndicators(buildInput({ cpl: 12 }));
      expect(cpl.color).toBe('green');
    });

    it('value 15 (dentro da tolerancia de 50%) fica amarelo', () => {
      const [cpl] = service.buildIndicators(buildInput({ cpl: 15 }));
      expect(cpl.color).toBe('yellow');
    });

    it('value 18 (exatamente no limite da tolerancia, 12*1.5) fica amarelo', () => {
      const [cpl] = service.buildIndicators(buildInput({ cpl: 18 }));
      expect(cpl.color).toBe('yellow');
    });

    it('value 18.01 (um passo alem do limite) fica vermelho', () => {
      const [cpl] = service.buildIndicators(buildInput({ cpl: 18.01 }));
      expect(cpl.color).toBe('red');
    });
  });

  describe('CTR (maior e melhor, alvo 2%)', () => {
    it('value 3 (acima do alvo) fica verde', () => {
      const [, ctr] = service.buildIndicators(buildInput({ ctrPct: 3 }));
      expect(ctr.color).toBe('green');
    });

    it('value 2 (igual ao alvo, fronteira) fica verde', () => {
      const [, ctr] = service.buildIndicators(buildInput({ ctrPct: 2 }));
      expect(ctr.color).toBe('green');
    });

    it('value 1.5 (dentro da tolerancia de 50%) fica amarelo', () => {
      const [, ctr] = service.buildIndicators(buildInput({ ctrPct: 1.5 }));
      expect(ctr.color).toBe('yellow');
    });

    it('value 1 (exatamente no limite da tolerancia, 2*0.5) fica amarelo', () => {
      const [, ctr] = service.buildIndicators(buildInput({ ctrPct: 1 }));
      expect(ctr.color).toBe('yellow');
    });

    it('value 0.9 (um passo alem do limite) fica vermelho', () => {
      const [, ctr] = service.buildIndicators(buildInput({ ctrPct: 0.9 }));
      expect(ctr.color).toBe('red');
    });
  });

  describe('Frequencia (menor e melhor, alvo 3)', () => {
    it('value 2 (abaixo do alvo) fica verde', () => {
      const indicators = service.buildIndicators(buildInput({ frequency: 2 }));
      const frequency = indicators.find((i) => i.key === 'frequency')!;
      expect(frequency.color).toBe('green');
    });

    it('value 4 (dentro da tolerancia, o limite e 4.5) fica amarelo', () => {
      const indicators = service.buildIndicators(buildInput({ frequency: 4 }));
      const frequency = indicators.find((i) => i.key === 'frequency')!;
      expect(frequency.color).toBe('yellow');
    });

    it('value 5 (alem do limite de 4.5) fica vermelho', () => {
      const indicators = service.buildIndicators(buildInput({ frequency: 5 }));
      const frequency = indicators.find((i) => i.key === 'frequency')!;
      expect(frequency.color).toBe('red');
    });
  });

  describe('Leads por dia (maior e melhor, segue a mesma regra do CTR)', () => {
    it('value acima do alvo fica verde', () => {
      const indicators = service.buildIndicators(buildInput({ leadsPerDay: 12 }));
      const leads = indicators.find((i) => i.key === 'leadsPerDay')!;
      expect(leads.color).toBe('green');
    });

    it('value dentro da tolerancia (>= alvo*0.5) fica amarelo', () => {
      // alvo 10, tolerancia 50% -> limite inferior do amarelo e 5
      const indicators = service.buildIndicators(buildInput({ leadsPerDay: 6 }));
      const leads = indicators.find((i) => i.key === 'leadsPerDay')!;
      expect(leads.color).toBe('yellow');
    });

    it('value abaixo do limite de tolerancia fica vermelho', () => {
      const indicators = service.buildIndicators(buildInput({ leadsPerDay: 4 }));
      const leads = indicators.find((i) => i.key === 'leadsPerDay')!;
      expect(leads.color).toBe('red');
    });
  });

  describe('Taxa de conversao (maior e melhor, segue a mesma regra do CTR)', () => {
    it('value acima do alvo fica verde', () => {
      const indicators = service.buildIndicators(buildInput({ conversionPct: 25 }));
      const conversion = indicators.find((i) => i.key === 'conversionPct')!;
      expect(conversion.color).toBe('green');
    });

    it('value dentro da tolerancia (alvo 20, limite 10) fica amarelo', () => {
      const indicators = service.buildIndicators(buildInput({ conversionPct: 12 }));
      const conversion = indicators.find((i) => i.key === 'conversionPct')!;
      expect(conversion.color).toBe('yellow');
    });

    it('value abaixo do limite de tolerancia fica vermelho', () => {
      const indicators = service.buildIndicators(buildInput({ conversionPct: 9 }));
      const conversion = indicators.find((i) => i.key === 'conversionPct')!;
      expect(conversion.color).toBe('red');
    });
  });

  describe('Ritmo de gasto (regra propria, sem amarelo)', () => {
    it('gasto no mesmo ritmo do tempo decorrido (50/50) fica verde', () => {
      const indicators = service.buildIndicators(
        buildInput({ budgetPace: { spentPct: 50, timePct: 50 } }),
      );
      const pace = indicators.find((i) => i.key === 'budgetPace')!;
      expect(pace.color).toBe('green');
      expect(pace.value).toBe(50);
      expect(pace.target).toBe(50);
    });

    it('gasto 15pp a frente do tempo (65/50) fica vermelho', () => {
      const indicators = service.buildIndicators(
        buildInput({ budgetPace: { spentPct: 65, timePct: 50 } }),
      );
      const pace = indicators.find((i) => i.key === 'budgetPace')!;
      expect(pace.color).toBe('red');
    });

    it('gasto 9pp a frente do tempo, dentro da tolerancia de 10pp, fica verde', () => {
      const indicators = service.buildIndicators(
        buildInput({ budgetPace: { spentPct: 59, timePct: 50 } }),
      );
      const pace = indicators.find((i) => i.key === 'budgetPace')!;
      expect(pace.color).toBe('green');
    });

    it('fica cinza quando monthlyBudget e nulo, mesmo com budgetPace calculado', () => {
      const goalsNoBudget: HealthGoals = { ...FULL_GOALS, monthlyBudget: null };
      const indicators = service.buildIndicators(buildInput({ goals: goalsNoBudget }));
      const pace = indicators.find((i) => i.key === 'budgetPace')!;
      expect(pace.color).toBe('grey');
    });

    it('fica cinza quando monthlyBudget e zero', () => {
      const goalsZeroBudget: HealthGoals = { ...FULL_GOALS, monthlyBudget: 0 };
      const indicators = service.buildIndicators(buildInput({ goals: goalsZeroBudget }));
      const pace = indicators.find((i) => i.key === 'budgetPace')!;
      expect(pace.color).toBe('grey');
    });

    it('fica cinza quando nao ha budgetPace calculado, mesmo com meta de budget configurada', () => {
      const indicators = service.buildIndicators(buildInput({ budgetPace: null }));
      const pace = indicators.find((i) => i.key === 'budgetPace')!;
      expect(pace.color).toBe('grey');
    });
  });

  describe('metadados fixos de cada indicador', () => {
    it('usa o formato certo por indicador (moeda, percentual ou numero)', () => {
      const indicators = service.buildIndicators(buildInput());
      const byKey = Object.fromEntries(indicators.map((i) => [i.key, i]));
      expect(byKey.cpl.format).toBe('currency');
      expect(byKey.ctrPct.format).toBe('percent');
      expect(byKey.leadsPerDay.format).toBe('number');
      expect(byKey.frequency.format).toBe('number');
      expect(byKey.conversionPct.format).toBe('percent');
      expect(byKey.budgetPace.format).toBe('percent');
    });

    it('usa rotulos em portugues', () => {
      const indicators = service.buildIndicators(buildInput());
      const byKey = Object.fromEntries(indicators.map((i) => [i.key, i]));
      expect(byKey.cpl.label).toBe('Custo por lead');
      expect(byKey.ctrPct.label).toBe('CTR');
      expect(byKey.leadsPerDay.label).toBe('Leads por dia');
      expect(byKey.frequency.label).toBe('Frequência');
      expect(byKey.conversionPct.label).toBe('Taxa de conversão');
      expect(byKey.budgetPace.label).toBe('Ritmo de gasto');
    });
  });
});
