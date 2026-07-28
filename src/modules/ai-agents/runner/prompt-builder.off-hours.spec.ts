import { PromptBuilderService, PromptContext } from './prompt-builder.service';

/**
 * Off-hours announcement injection into the LIVE prompt path.
 * Fora do horário (`isWithinHours` === false) o bloco volátil "═══ Agora ═══"
 * ganha o horário de atendimento + próximo retorno + diretiva pra Aline avisar.
 * Dentro do horário / 24-7 (aiBusinessHours null) => nada é acrescentado.
 */
function buildCtx(orgOverride: Record<string, unknown>): PromptContext {
  return {
    organization: {
      name: 'Orlando Fast Pass',
      aiBusinessNotes: null,
      aiTimezone: 'America/Sao_Paulo',
      aiBusinessHours: null,
      aiOffHoursMode: 'ATTEND',
      ...orgOverride,
    },
    agent: {
      name: 'Aline',
      systemPrompt: 'Você é uma consultora de viagens.',
      operationalContext: null,
      operationalContextUpdatedAt: null,
      kind: 'WORKER',
      voiceProfile: null,
    },
    channel: { name: 'WhatsApp', type: 'WHATSAPP' },
    contact: { name: 'Maria', phone: null, email: null },
    conversation: {},
    recentMessages: [],
    memorySummary: null,
    memoryFacts: null,
    triggerMessage: {
      id: 't1',
      type: 'TEXT',
      content: { text: 'Oi, quero um orçamento pra Orlando' },
      metadata: {},
    },
    skillInstructions: [],
    catalog: [],
  } as unknown as PromptContext;
}

describe('PromptBuilderService — fora do horário', () => {
  afterEach(() => jest.useRealTimers());

  it('fora do horário + agenda seg 09-18: injeta horário e diretiva', () => {
    // domingo 09h BRT (12h UTC) => fechado (só seg habilitado)
    jest.useFakeTimers().setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
    const svc = new PromptBuilderService();
    const msgs = svc.buildMessages(
      buildCtx({
        aiBusinessHours: { monday: { enabled: true, windows: [['09:00', '18:00']] } },
        aiTimezone: 'America/Sao_Paulo',
        aiOffHoursMode: 'ATTEND',
      }),
    );
    const systemText = JSON.stringify(msgs.find((m) => m.role === 'system'));
    expect(systemText).toContain('FORA DO HORÁRIO');
    expect(systemText).toContain('seg');
    expect(systemText.toLowerCase()).toContain('avise');
  });

  it('24/7 (aiBusinessHours null): não injeta bloco de fora-de-horário', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-26T12:00:00.000Z'));
    const svc = new PromptBuilderService();
    const msgs = svc.buildMessages(
      buildCtx({
        aiBusinessHours: null,
        aiTimezone: 'America/Sao_Paulo',
        aiOffHoursMode: 'SILENT',
      }),
    );
    const systemText = JSON.stringify(msgs.find((m) => m.role === 'system'));
    expect(systemText).not.toContain('FORA DO HORÁRIO');
  });

  it('dentro do horário: não injeta bloco de fora-de-horário', () => {
    // segunda 12h BRT (15h UTC) => aberto
    jest.useFakeTimers().setSystemTime(new Date('2026-07-27T15:00:00.000Z'));
    const svc = new PromptBuilderService();
    const msgs = svc.buildMessages(
      buildCtx({
        aiBusinessHours: { monday: { enabled: true, windows: [['09:00', '18:00']] } },
        aiTimezone: 'America/Sao_Paulo',
        aiOffHoursMode: 'ATTEND',
      }),
    );
    const systemText = JSON.stringify(msgs.find((m) => m.role === 'system'));
    expect(systemText).not.toContain('FORA DO HORÁRIO');
  });
});
