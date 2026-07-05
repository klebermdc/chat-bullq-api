import { mapAiAgent } from './ai-agent.mapper';

describe('mapAiAgent', () => {
  const raw = {
    id: 'ag1', organizationId: 'o', name: 'Vendas Bot', description: 'vende', avatarUrl: 'http://x/a.png',
    kind: 'WORKER', category: 'sales', capabilities: ['reply', 'offer'], parentAgentId: 'ceo1',
    department: 'VENDAS', squad: 'Inbound', modelId: 'claude-sonnet-5', isActive: true,
    canRespondDirectly: true, createdAt: new Date('2026-01-01'), deletedAt: null,
    systemPrompt: 'VOCÊ É ...', operationalContext: 'hoje teve aula ...', modelParams: { topP: 0.9 },
    temperature: 0.7, maxTokens: 2048, followUpCadenceHours: [4, 24],
    channels: [{ channel: { id: 'ch1', name: 'WhatsApp', type: 'WHATSAPP_CLOUD' } }],
  };

  it('expõe só metadados seguros e NUNCA vaza systemPrompt/operationalContext/modelParams', () => {
    const out = mapAiAgent(raw as any);
    expect(out).toEqual({
      id: 'ag1', name: 'Vendas Bot', description: 'vende', avatarUrl: 'http://x/a.png',
      kind: 'WORKER', category: 'sales', department: 'VENDAS', squad: 'Inbound', parentAgentId: 'ceo1',
      capabilities: ['reply', 'offer'], isActive: true, canRespondDirectly: true,
      modelId: 'claude-sonnet-5', createdAt: new Date('2026-01-01'),
      channels: [{ id: 'ch1', name: 'WhatsApp', type: 'WHATSAPP_CLOUD' }],
    });
    expect((out as any).systemPrompt).toBeUndefined();
    expect((out as any).operationalContext).toBeUndefined();
    expect((out as any).modelParams).toBeUndefined();
    expect((out as any).temperature).toBeUndefined();
    expect((out as any).maxTokens).toBeUndefined();
    expect((out as any).organizationId).toBeUndefined();
  });

  it('tolera agente sem channels', () => {
    const out = mapAiAgent({ id: 'ag2', name: 'x', kind: 'WORKER', capabilities: [], isActive: true, canRespondDirectly: false, modelId: 'm', createdAt: new Date() } as any);
    expect(out.channels).toEqual([]);
  });
});
