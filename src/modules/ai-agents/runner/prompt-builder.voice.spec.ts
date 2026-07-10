import { PromptBuilderService, PromptContext } from './prompt-builder.service';

/**
 * Voice profile gating: the global template hardcodes a "consultive" voice
 * (ZERO emoji, no bullets, no travessão) for every agent. A `voiceProfile`
 * of 'warm' must swap that block for a warm variant WITHOUT changing the
 * default behavior for every other agent (prompt-cache safe).
 */
function buildCtx(agentOverrides: Record<string, unknown>): PromptContext {
  const agent = {
    name: 'Aline',
    systemPrompt: 'Você é uma consultora de viagens.',
    operationalContext: null,
    operationalContextUpdatedAt: null,
    kind: 'WORKER',
    voiceProfile: null,
    ...agentOverrides,
  };
  return {
    organization: {
      name: 'Orlando Fast Pass',
      aiBusinessNotes: null,
      aiTimezone: 'America/Sao_Paulo',
    },
    agent,
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

function systemText(ctx: PromptContext): string {
  const messages = new PromptBuilderService().buildMessages(ctx);
  const parts = (messages[0].content as Array<{ text?: string }>) ?? [];
  return parts.map((p) => p.text ?? '').join('\n');
}

describe('PromptBuilderService — voiceProfile', () => {
  it('keeps the strict consultive voice for a default agent (unchanged)', () => {
    const text = systemText(buildCtx({ voiceProfile: null }));
    expect(text).toContain('ZERO emoji');
  });

  it('swaps to a warm voice that permits emojis when voiceProfile=warm', () => {
    const text = systemText(buildCtx({ voiceProfile: 'warm' }));
    expect(text).not.toContain('ZERO emoji');
    expect(text).toContain('Emojis são BEM-VINDOS');
  });
});
