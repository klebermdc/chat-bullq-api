import { PromptBuilderService, PromptContext } from './prompt-builder.service';

function buildCtx(onCall?: PromptContext['onCall']): PromptContext {
  return {
    organization: {
      name: 'Orlando Fast Pass',
      aiBusinessNotes: null,
      aiTimezone: 'America/Sao_Paulo',
      // Org sempre fechada: fora do plantão, entraria o bloco de horário da org.
      aiBusinessHours: { monday: { enabled: false } },
      aiOffHoursMode: 'ATTEND',
    },
    agent: {
      name: 'Aline',
      systemPrompt: 'Você é uma consultora de viagens.',
      operationalContext: null,
      operationalContextUpdatedAt: null,
      kind: 'ORCHESTRATOR',
      voiceProfile: null,
    },
    channel: { name: 'WhatsApp', type: 'WHATSAPP' },
    contact: { name: 'Maria', phone: null, email: null },
    conversation: {},
    recentMessages: [],
    memorySummary: null,
    memoryFacts: null,
    triggerMessage: { id: 't1', type: 'TEXT', content: { text: 'Oi, ainda tem ingresso?' }, metadata: {} },
    skillInstructions: [],
    catalog: [],
    onCall,
  } as unknown as PromptContext;
}

function volatilePart(ctx: PromptContext): string {
  const system = new PromptBuilderService().buildMessages(ctx).find((m) => m.role === 'system') as any;
  return system.content[1].text as string;
}

describe('PromptBuilderService — Aline de plantão', () => {
  it('no plantão, diz quem é o vendedor, quando volta e o que a Aline não pode fazer', () => {
    const text = volatilePart(buildCtx({ sellerName: 'Pedro', returnAt: 'amanhã às 9h' }));

    expect(text).toContain('PLANTÃO');
    expect(text).toContain('Pedro');
    expect(text).toContain('amanhã às 9h');
    expect(text).toContain('leaveNoteForSeller');
    expect(text).toContain('NÃO negocie');
  });

  it('no plantão, não manda "continuar qualificando" do horário da org', () => {
    const text = volatilePart(buildCtx({ sellerName: 'Pedro', returnAt: 'amanhã às 9h' }));

    expect(text).not.toContain('Continue qualificando');
  });

  it('fora do plantão, o bloco de horário da org continua igual', () => {
    const text = volatilePart(buildCtx());

    expect(text).toContain('FORA DO HORÁRIO');
    expect(text).not.toContain('PLANTÃO');
  });

  it('o bloco fixo (cacheado) é o mesmo com e sem plantão', () => {
    const builder = new PromptBuilderService();
    const cached = (ctx: PromptContext) =>
      (builder.buildMessages(ctx).find((m) => m.role === 'system') as any).content[0].text;

    expect(cached(buildCtx({ sellerName: 'Pedro', returnAt: 'amanhã às 9h' }))).toBe(cached(buildCtx()));
  });
});
