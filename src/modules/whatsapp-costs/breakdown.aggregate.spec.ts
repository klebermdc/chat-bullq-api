import { AUTOMATION_NAME, byTemplate, bySender, perConversation, percentile, type BilledMessageRow } from './breakdown.aggregate';

const PRICES = { SERVICE: 0.035, MARKETING: 0.3217 };

function row(over: Partial<BilledMessageRow>): BilledMessageRow {
  return {
    category: 'SERVICE', conversationId: 'c1', senderId: null, senderName: null, userName: null,
    isAi: false, isAutomated: false, templateName: null, templateCategory: null, ...over,
  };
}

describe('breakdown.aggregate', () => {
  const rows = [
    row({ senderId: 'u1', userName: 'Pedro', conversationId: 'c1' }),
    row({ senderId: 'u1', userName: 'Pedro', conversationId: 'c2' }),
    row({ senderId: 'u1', userName: 'Pedro', conversationId: 'c2', category: 'MARKETING', templateName: 'atendimento', templateCategory: 'MARKETING' }),
    row({ isAi: true, senderName: 'Aline', conversationId: 'c3' }),
    row({ senderId: 'u2', userName: 'Bárbara', isAutomated: true, category: 'MARKETING', templateName: 'candecia1', templateCategory: 'MARKETING' }),
    row({ conversationId: null }),
  ];

  it('agrupa por vendedor, separa IA e automações, ordena por custo', () => {
    const senders = bySender(rows, PRICES);
    expect(senders.map((s) => s.name)).toEqual(['Pedro', AUTOMATION_NAME, 'Aline', 'Sistema']);
    expect(senders[0]).toEqual({ name: 'Pedro', kind: 'agent', service: 2, marketing: 1, utility: 0, cost: 0.39, conversations: 2 });
    expect(senders[1].kind).toBe('system');
    expect(senders[2].kind).toBe('ai');
  });

  it('agrupa templates com envios e custo', () => {
    expect(byTemplate(rows, PRICES)).toEqual([
      { name: 'atendimento', category: 'MARKETING', sent: 1, cost: 0.32 },
      { name: 'candecia1', category: 'MARKETING', sent: 1, cost: 0.32 },
    ]);
  });

  it('respostas cobradas por conversa', () => {
    expect(perConversation(rows)).toEqual({ median: 1, p90: 1, max: 1, conversations: 3 });
    expect(perConversation([])).toBeNull();
  });

  it('percentil pela posição mais próxima', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 90)).toBe(9);
    expect(percentile([], 50)).toBe(0);
  });
});
