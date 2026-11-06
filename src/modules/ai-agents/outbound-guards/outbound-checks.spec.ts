import {
  catalogWithoutPrices,
  fallbackRetryText,
  hasHumanAction,
  isToolBlockedByCommercialRule,
  outboundVetoFrom,
  promptEvidenceFrom,
  shouldSendSalesNudge,
  toolsForCommercialRule,
  withHumanActionTaken,
} from './outbound-checks';

const CTX = {
  organizationId: 'org-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  channelId: 'ch-1',
  agentId: 'agent-1',
  runId: 'run-1',
};

describe('hasHumanAction', () => {
  it('conta transferToHuman e leaveNoteForSeller que funcionaram', () => {
    expect(hasHumanAction([{ name: 'transferToHuman', ok: true }])).toBe(true);
    expect(hasHumanAction([{ name: 'leaveNoteForSeller', ok: true }])).toBe(true);
  });

  it('não conta outras ferramentas nem ações que falharam', () => {
    expect(hasHumanAction([])).toBe(false);
    expect(hasHumanAction([{ name: 'lookupOffering', ok: true }])).toBe(false);
    expect(hasHumanAction([{ name: 'transferToHuman', ok: false }])).toBe(false);
  });
});

describe('withHumanActionTaken', () => {
  it('marca a ação e tira a evidência (mensagem do sistema não é conferida), sem mexer no original', () => {
    const original = {
      ...CTX,
      outboundGuards: { priorToolCalls: [{ name: 'lookupOffering', ok: true }], promptEvidence: 'x' },
    };

    const novo = withHumanActionTaken(original, 'transferToHuman');

    expect(novo.outboundGuards).toEqual({
      priorToolCalls: [
        { name: 'lookupOffering', ok: true },
        { name: 'transferToHuman', ok: true },
      ],
    });
    expect(original.outboundGuards.priorToolCalls).toHaveLength(1);
    expect(original.outboundGuards.promptEvidence).toBe('x');
  });

  it('funciona sem contexto de travas', () => {
    expect(withHumanActionTaken(CTX, 'transferToHuman').outboundGuards).toEqual({
      priorToolCalls: [{ name: 'transferToHuman', ok: true }],
    });
  });
});

describe('promptEvidenceFrom', () => {
  it('junta a camada de segurança com o texto do system prompt', () => {
    const evidencia = promptEvidenceFrom('REGRAS', [
      { type: 'text', text: 'Persona e catálogo' },
      { type: 'text', text: 'Hora atual' },
    ]);
    expect(evidencia).toBe('REGRAS\n\nPersona e catálogo\nHora atual');
  });

  it('aceita conteúdo em string', () => {
    expect(promptEvidenceFrom('REGRAS', 'Persona')).toBe('REGRAS\n\nPersona');
  });
});

describe('outboundVetoFrom / fallbackRetryText', () => {
  it('reconhece só os bloqueios das travas novas', () => {
    expect(
      outboundVetoFrom({ ok: false, error: 'commercial_talk_blocked', message: 'veto comercial' }),
    ).toBe('veto comercial');
    expect(
      outboundVetoFrom({ ok: false, error: 'human_promise_without_action', message: 'veto promessa' }),
    ).toBe('veto promessa');
    expect(outboundVetoFrom({ ok: false, error: 'meta_talk_blocked', message: 'x' })).toBeNull();
    expect(outboundVetoFrom({ ok: true, messageId: 'm1' })).toBeNull();
    expect(outboundVetoFrom(null)).toBeNull();
  });

  it('o lembrete diz que nada foi enviado e repete o veto', () => {
    const texto = fallbackRetryText('veto comercial');
    expect(texto).toMatch(/NÃO foi enviada/);
    expect(texto).toContain('veto comercial');
  });
});

describe('regra comercial nas ferramentas e na cutucada', () => {
  const TOOLS = [
    { name: 'replyToConversation', description: '', parameters: {} },
    { name: 'lookupOffering', description: '', parameters: {} },
    { name: 'checkPurchase', description: '', parameters: {} },
  ];

  it('com blockCommercialTalk, lookupOffering sai das ferramentas oferecidas', () => {
    expect(toolsForCommercialRule(TOOLS, true).map((t) => t.name)).toEqual([
      'replyToConversation',
      'checkPurchase',
    ]);
    expect(isToolBlockedByCommercialRule('lookupOffering', true)).toBe(true);
  });

  it('sem a regra, lookupOffering continua (mesma lista de hoje)', () => {
    expect(toolsForCommercialRule(TOOLS, false)).toEqual(TOOLS);
    expect(isToolBlockedByCommercialRule('lookupOffering', false)).toBe(false);
  });

  it('com blockCommercialTalk não existe cutucada de vendas', () => {
    const base = { calledSalesPrep: true, neverReplied: true, stillNoAction: true, nudgeUsed: false };
    expect(shouldSendSalesNudge({ ...base, blockCommercialTalk: false })).toBe(true);
    expect(shouldSendSalesNudge({ ...base, blockCommercialTalk: true })).toBe(false);
    expect(shouldSendSalesNudge({ ...base, nudgeUsed: true, blockCommercialTalk: false })).toBe(false);
  });
});

describe('catalogWithoutPrices', () => {
  it('tira a descrição que fala de valor e mantém as outras, sem mexer no original', () => {
    const catalogo = [
      { slug: 'a', shortLine: 'a partir de R$ 699' },
      { slug: 'b', shortLine: 'guia nos 4 parques' },
    ];
    expect(catalogWithoutPrices(catalogo)).toEqual([
      { slug: 'a', shortLine: '' },
      { slug: 'b', shortLine: 'guia nos 4 parques' },
    ]);
    expect(catalogo[0].shortLine).toBe('a partir de R$ 699');
  });
});
