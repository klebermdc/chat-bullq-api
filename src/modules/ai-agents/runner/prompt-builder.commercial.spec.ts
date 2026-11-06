import { PromptBuilderService, PromptContext } from './prompt-builder.service';

const CATALOGO = [
  { slug: 'ingresso-4-dias', name: 'Ingresso 4 dias', category: 'Parques', shortLine: 'a partir de R$ 699 em 10x' },
  { slug: 'guia-parques', name: 'Guia nos parques', category: 'Parques', shortLine: 'acompanhamento nos 4 parques' },
];

function systemText(blockCommercialTalk: boolean): string {
  const ctx = {
    organization: {
      name: 'Orlando Fast Pass',
      aiBusinessNotes: null,
      aiTimezone: 'America/Sao_Paulo',
      aiBusinessHours: null,
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
    triggerMessage: { id: 't1', type: 'TEXT', content: { text: 'Oi' }, metadata: {} },
    skillInstructions: [],
    catalog: CATALOGO,
    blockCommercialTalk,
  } as unknown as PromptContext;
  const system = new PromptBuilderService().buildMessages(ctx).find((m) => m.role === 'system') as any;
  return system.content[0].text as string;
}

describe('PromptBuilderService — catálogo com blockCommercialTalk', () => {
  it('com a regra: catálogo só para entender o cliente, sem instrução de link nem preço', () => {
    const text = systemText(true);

    expect(text).toContain('só para entender o que o cliente procura');
    expect(text).toContain('preço, link e compra são com o consultor');
    expect(text).not.toContain('chame a skill `lookupOffering`');
    expect(text).not.toContain('R$ 699');
    expect(text).toContain('Ingresso 4 dias');
    expect(text).toContain('acompanhamento nos 4 parques');
  });

  it('sem a regra: instrução e linhas de hoje', () => {
    const text = systemText(false);

    expect(text).toContain('chame a skill `lookupOffering` com o slug');
    expect(text).toContain('a partir de R$ 699 em 10x');
  });
});
