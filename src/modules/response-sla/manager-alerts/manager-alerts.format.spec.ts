import {
  firstName,
  formatAgentBreakdown,
  formatOldest,
  formatOverall,
  formatAgentScores,
  sanitizeTemplateParam,
} from './manager-alerts.format';

describe('sanitizeTemplateParam', () => {
  it('troca quebra de linha e tab por espaço e colapsa espaços', () => {
    expect(sanitizeTemplateParam('Maria\nSilva\t\tcom    Pedro')).toBe('Maria Silva com Pedro');
  });
  it('nunca devolve vazio (a Meta recusa parâmetro vazio)', () => {
    expect(sanitizeTemplateParam('  \n ')).toBe('-');
  });
  it('corta textos longos', () => {
    const result = sanitizeTemplateParam('a'.repeat(1000));
    expect(result.length).toBeLessThanOrEqual(300);
    expect(result.endsWith('…')).toBe(true);
  });
});

describe('firstName', () => {
  it('pega o primeiro nome', () => {
    expect(firstName('  Pedro Henrique Souza ')).toBe('Pedro');
  });
  it('cai no fallback quando vazio', () => {
    expect(firstName('')).toBe('-');
  });
});

describe('formatAgentBreakdown', () => {
  it('ordena por quantidade desc, depois nome, e usa "sem dono"', () => {
    const result = formatAgentBreakdown([
      { agentName: 'Suelen Lima' },
      { agentName: 'Pedro Alves' },
      { agentName: null },
      { agentName: 'Pedro Alves' },
    ]);
    expect(result).toBe('Pedro 2, Suelen 1, sem dono 1');
  });
  it('lista vazia vira "nenhum"', () => {
    expect(formatAgentBreakdown([])).toBe('nenhum');
  });
});

describe('formatOldest', () => {
  it('cliente, dono e minutos úteis', () => {
    expect(
      formatOldest([
        { contactName: 'João', agentName: 'Suelen', businessMinutes: 31.9 },
        { contactName: 'Maria Silva', agentName: 'Pedro Alves', businessMinutes: 52.4 },
      ]),
    ).toBe('Maria Silva com Pedro, 52 min');
  });
  it('sem dono', () => {
    expect(formatOldest([{ contactName: 'Ana', agentName: null, businessMinutes: 40 }])).toBe(
      'Ana sem dono, 40 min',
    );
  });
  it('lista vazia vira "nenhum"', () => {
    expect(formatOldest([])).toBe('nenhum');
  });
});

describe('placar', () => {
  it('formata o geral', () => {
    expect(formatOverall({ within: 41, total: 50 })).toBe('82% (41 de 50 no prazo)');
  });
  it('geral sem esperas vira "nenhum"', () => {
    expect(formatOverall(null)).toBe('nenhum');
  });
  it('lista por atendente em ordem decrescente', () => {
    expect(
      formatAgentScores([
        { agentName: 'Pedro Alves', percent: 71 },
        { agentName: 'Renata Dias', percent: 94 },
      ]),
    ).toBe('Renata 94%, Pedro 71%');
  });
  it('sem atendentes vira "nenhum"', () => {
    expect(formatAgentScores([])).toBe('nenhum');
  });
});
