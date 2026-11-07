import { WebsiteLeadFollowupService, renderTemplateText } from './website-lead-followup.service';

const NOW = new Date('2026-11-07T15:05:00.000Z');
const SUB = {
  id: 'sub-1',
  organizationId: 'org-1',
  contactId: 'contact-1',
  phone: '5511988887777',
  formKind: 'main',
  createdAt: new Date('2026-11-07T15:00:00.000Z'),
};
const TEMPLATE = {
  id: 'tpl-1',
  name: 'lead_site_retorno',
  language: 'pt_BR',
  category: 'MARKETING',
  status: 'APPROVED',
  components: { body: { text: 'Olá! {{1}} 👋 Sou da Orlando Fast Pass!' } },
  variableExamples: { '1': 'Maria' },
};

function make(o: {
  config?: any;
  template?: any;
  inbound?: any;
  human?: any;
  recent?: any;
  claimed?: number;
  conv?: any;
  legacy?: any;
} = {}) {
  const prisma = {
    leadSubmission: {
      updateMany: jest.fn().mockResolvedValue({ count: o.claimed ?? 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(SUB),
      findFirst: jest.fn().mockResolvedValue(o.recent ?? null),
      update: jest.fn().mockResolvedValue({}),
    },
    websiteLeadSettings: {
      findUnique: jest.fn().mockResolvedValue(
        o.config === undefined
          ? { enabled: true, channelId: 'ch-5198', templateId: 'tpl-1', delayMinutes: 5 }
          : o.config,
      ),
    },
    channel: { findFirst: jest.fn().mockResolvedValue({ id: 'ch-5198' }) },
    messageTemplate: { findFirst: jest.fn().mockResolvedValue(o.template === undefined ? TEMPLATE : o.template) },
    contact: {
      findMany: jest.fn().mockResolvedValue([{ id: 'contact-1' }, { id: 'contact-umbler' }]),
      findUnique: jest.fn().mockResolvedValue({ name: 'Maria Teste' }),
    },
    contactChannel: { findMany: jest.fn().mockResolvedValue([]) },
    message: { findFirst: jest.fn().mockResolvedValue(o.inbound ?? null) },
    conversation: {
      findFirst: jest.fn().mockResolvedValue(o.human ?? null),
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue(o.conv ?? { assignedToId: null, metadata: {}, channelId: 'ch-5198' }),
      update: jest.fn().mockResolvedValue({ id: 'conv-1' }),
    },
    aiAgentChannel: { findFirst: jest.fn().mockResolvedValue({ agent: { id: 'aline', name: 'Aline' } }) },
    tag: {
      findFirst: jest.fn().mockResolvedValue({ id: 'tag-site' }),
      upsert: jest.fn(),
    },
    conversationTag: { upsert: jest.fn().mockResolvedValue({}) },
  } as any;
  const start = {
    start: jest.fn().mockResolvedValue({ conversationId: 'conv-1', contactId: 'contact-1', messageId: 'msg-1' }),
  } as any;
  const legacy = {
    routeNewConversation: jest.fn().mockResolvedValue(o.legacy ?? { routed: false, reason: 'not_found' }),
  } as any;
  const leadCard = { ensureLeadCard: jest.fn().mockResolvedValue(null) } as any;
  const realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn() } as any;
  return {
    service: new WebsiteLeadFollowupService(prisma, start, legacy, leadCard, realtime),
    prisma,
    start,
    legacy,
    leadCard,
  };
}

describe('WebsiteLeadFollowupService.fire', () => {
  it('outro worker já pegou → não faz nada', async () => {
    const { service, start } = make({ claimed: 0 });
    expect(await service.fire('sub-1', NOW)).toEqual({ status: 'NOOP' });
    expect(start.start).not.toHaveBeenCalled();
  });

  it('cliente já escreveu no canal depois do formulário → não manda', async () => {
    const { service, start, prisma } = make({ inbound: { id: 'm-in' } });
    expect(await service.fire('sub-1', NOW)).toEqual({ status: 'SKIPPED', reason: 'customer_wrote' });
    expect(start.start).not.toHaveBeenCalled();
    // A mensagem pode ter caído no contato antigo da Umbler: os dois contam.
    expect(prisma.message.findFirst).toHaveBeenCalledWith({
      where: {
        direction: 'INBOUND',
        createdAt: { gte: SUB.createdAt },
        conversation: { channelId: 'ch-5198', contactId: { in: ['contact-1', 'contact-umbler'] } },
      },
      select: { id: true },
    });
  });

  it('humano atendendo numa conversa aberta → não manda', async () => {
    const { service, start } = make({ human: { id: 'conv-x' } });
    expect(await service.fire('sub-1', NOW)).toEqual({ status: 'SKIPPED', reason: 'human_active' });
    expect(start.start).not.toHaveBeenCalled();
  });

  it('já recebeu o template nas últimas 24h → não paga de novo', async () => {
    const { service, start } = make({ recent: { id: 'sub-0' } });
    expect(await service.fire('sub-1', NOW)).toEqual({ status: 'SKIPPED', reason: 'recent_followup' });
    expect(start.start).not.toHaveBeenCalled();
  });

  it('desligado depois do agendamento → não manda', async () => {
    const { service, start } = make({ config: { enabled: false } });
    expect(await service.fire('sub-1', NOW)).toEqual({ status: 'SKIPPED', reason: 'disabled' });
    expect(start.start).not.toHaveBeenCalled();
  });

  it('template ainda não aprovado → FAILED, sem envio', async () => {
    const { service, start } = make({ template: { ...TEMPLATE, status: 'PENDING' } });
    expect(await service.fire('sub-1', NOW)).toEqual({ status: 'FAILED', reason: 'template_not_approved' });
    expect(start.start).not.toHaveBeenCalled();
  });

  it('manda o template com o primeiro nome, deixa a Aline responsável e registra o envio', async () => {
    const { service, start, prisma, legacy, leadCard } = make();

    expect(await service.fire('sub-1', NOW)).toEqual({ status: 'SENT' });

    expect(start.start).toHaveBeenCalledWith(
      'org-1',
      {
        channelId: 'ch-5198',
        contactId: 'contact-1',
        template: {
          name: 'lead_site_retorno',
          language: { code: 'pt_BR' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: 'Maria' }] }],
        },
      },
      'ALL',
      undefined,
      { source: 'website_lead_followup', senderName: 'Aline', renderedText: 'Olá! Maria 👋 Sou da Orlando Fast Pass!' },
    );
    expect(legacy.routeNewConversation).toHaveBeenCalledWith(
      { organizationId: 'org-1', conversationId: 'conv-1', contactId: 'contact-1' },
      { aiUntilHandoffAgentId: 'aline' },
    );
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: {
        aiEnabled: true,
        activeAgentId: 'aline',
        aiUntilHandoff: true,
        metadata: {
          websiteLead: { submissionId: 'sub-1', followupSentAt: NOW.toISOString(), formKind: 'main' },
        },
      },
    });
    expect(prisma.conversationTag.upsert).toHaveBeenCalled();
    expect(leadCard.ensureLeadCard).toHaveBeenCalledWith({
      organizationId: 'org-1',
      conversationId: 'conv-1',
      contactId: 'contact-1',
    });
    expect(prisma.leadSubmission.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: expect.objectContaining({
        followupStatus: 'SENT',
        followupConversationId: 'conv-1',
        followupMessageId: 'msg-1',
        followupTemplateName: 'lead_site_retorno',
        followupCategory: 'MARKETING',
      }),
    });
  });

  it('cliente da carteira: a carteira atribui ao vendedor com a Aline, e não sobrescrevemos a IA', async () => {
    const { service, prisma } = make({ legacy: { routed: true, userId: 'renata', vendedor: 'Renata' } });

    await service.fire('sub-1', NOW);

    const data = prisma.conversation.update.mock.calls[0][0].data;
    expect(data.aiEnabled).toBeUndefined();
    expect(data.metadata.websiteLead.submissionId).toBe('sub-1');
  });

  it('conversa já com dono: mantém o dono, sem carteira, e a Aline conduz até o handoff', async () => {
    const { service, prisma, legacy } = make({
      conv: { assignedToId: 'pedro', metadata: {}, channelId: 'ch-5198' },
    });
    await service.fire('sub-1', NOW);
    expect(legacy.routeNewConversation).not.toHaveBeenCalled();
    expect(prisma.conversation.update.mock.calls[0][0].data).toMatchObject({
      aiEnabled: true,
      activeAgentId: 'aline',
      aiUntilHandoff: true,
    });
  });

  it('falha no envio vira FAILED com o motivo (sem relançar — não reenvia o pago)', async () => {
    const { service, start, prisma } = make();
    start.start.mockRejectedValue(new Error('Meta fora'));
    expect(await service.fire('sub-1', NOW)).toEqual({ status: 'FAILED', reason: 'Meta fora' });
    expect(prisma.leadSubmission.update).toHaveBeenCalledWith({
      where: { id: 'sub-1' },
      data: { followupStatus: 'FAILED', followupReason: 'Meta fora' },
    });
  });
});

describe('renderTemplateText', () => {
  it('troca as variáveis na ordem dos parâmetros', () => {
    expect(
      renderTemplateText('Oi {{1}}, tudo {{2}}?', {
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ana' }, { type: 'text', text: 'bem' }] }],
      }),
    ).toBe('Oi Ana, tudo bem?');
  });
});
