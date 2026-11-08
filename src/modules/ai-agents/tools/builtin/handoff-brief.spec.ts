import { buildHandoffBrief, HANDOFF_BRIEF_LIMITS } from './handoff-brief';

const NOW = new Date('2026-11-07T22:00:00.000Z');

describe('buildHandoffBrief', () => {
  it('monta a ficha com os campos que a Aline preencheu', () => {
    const brief = buildHandoffBrief(
      {
        summary: 'Família quer Disney + Universal em julho.',
        destination: 'Orlando — Disney e Universal',
        travelDates: '10 a 20/07/2027',
        travelers: '2 adultos + 2 crianças (5 e 8)',
        budget: 'até R$ 25 mil',
        pendingQuestions: 'Já tem passagem? Quer hotel na Disney?',
      },
      NOW,
    );

    expect(brief).toEqual({
      summary: 'Família quer Disney + Universal em julho.',
      destination: 'Orlando — Disney e Universal',
      travelDates: '10 a 20/07/2027',
      travelers: '2 adultos + 2 crianças (5 e 8)',
      budget: 'até R$ 25 mil',
      pendingQuestions: 'Já tem passagem? Quer hotel na Disney?',
      at: NOW.toISOString(),
    });
  });

  it('omite campos vazios, só com espaço ou que não são texto', () => {
    const brief = buildHandoffBrief(
      { summary: 'Quer orçamento de ingressos.', destination: '   ', budget: 123, travelers: null },
      NOW,
    );

    expect(brief).toEqual({ summary: 'Quer orçamento de ingressos.', at: NOW.toISOString() });
  });

  it('devolve null quando não há nada aproveitável', () => {
    expect(buildHandoffBrief({ reason: 'cliente pediu humano' }, NOW)).toBeNull();
    expect(buildHandoffBrief({ summary: '  ', destination: '' }, NOW)).toBeNull();
  });

  it('vale só com campos estruturados, sem summary', () => {
    const brief = buildHandoffBrief({ destination: 'Orlando' }, NOW);
    expect(brief).toEqual({ destination: 'Orlando', at: NOW.toISOString() });
  });

  it('corta textos longos no limite de cada campo', () => {
    const brief = buildHandoffBrief(
      { summary: 'a'.repeat(5000), destination: 'b'.repeat(5000) },
      NOW,
    );

    expect(brief?.summary).toHaveLength(HANDOFF_BRIEF_LIMITS.summary);
    expect(brief?.destination).toHaveLength(HANDOFF_BRIEF_LIMITS.field);
  });
});
