import { WebsiteLeadInboundService } from './website-lead-inbound.service';

const INPUT = {
  organizationId: 'org-1',
  channelId: 'ch-5198',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  conversationIsNewOrReopened: false,
  text: 'Sim, pode perguntar',
};
const FOLLOWUP_META = { websiteLead: { submissionId: 'sub-1', followupSentAt: '2026-11-07T15:05:00.000Z' } };

function make(conv: any, recentSubmission: any = null) {
  const prisma = {
    conversation: {
      findUnique: jest.fn().mockResolvedValue(conv),
      update: jest.fn().mockResolvedValue({ id: 'conv-1' }),
    },
    contact: { findUnique: jest.fn().mockResolvedValue({ name: 'Maria Teste' }) },
    aiAgent: { findUnique: jest.fn().mockResolvedValue({ name: 'Aline' }) },
    contactChannel: { findFirst: jest.fn().mockResolvedValue({ externalId: '5511988887777' }) },
    message: { create: jest.fn().mockResolvedValue({ id: 'msg-out' }) },
    conversationAuditLog: { create: jest.fn().mockResolvedValue({}) },
    leadSubmission: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirst: jest.fn().mockResolvedValue(recentSubmission),
    },
    tag: { findFirst: jest.fn().mockResolvedValue({ id: 'tag-site' }), upsert: jest.fn() },
    conversationTag: { upsert: jest.fn().mockResolvedValue({}) },
  } as any;
  const realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn() } as any;
  const queue = { add: jest.fn().mockResolvedValue({}) } as any;
  return { service: new WebsiteLeadInboundService(prisma, realtime, queue), prisma, queue };
}

describe('WebsiteLeadInboundService.evaluate', () => {
  it('conversa comum: não interfere', async () => {
    const { service } = make({ aiUntilHandoff: false, metadata: {}, assignedToId: null, status: 'PENDING' });
    expect(await service.evaluate(INPUT)).toEqual({ skipLegacyRouting: false, skipChatbot: false, skipAi: false });
  });

  it('resposta ao template ("Sim"): Aline segue — nem carteira nem chatbot entram', async () => {
    const { service, queue } = make({
      aiUntilHandoff: true,
      metadata: FOLLOWUP_META,
      assignedToId: 'renata',
      status: 'OPEN',
      activeAgentId: 'aline',
    });
    expect(await service.evaluate(INPUT)).toEqual({ skipLegacyRouting: true, skipChatbot: true, skipAi: false });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('"Agora não": agradece pelo nome, desliga a IA, encerra a conversa sem dono e marca recusa', async () => {
    const { service, prisma, queue } = make({
      aiUntilHandoff: true,
      metadata: FOLLOWUP_META,
      assignedToId: null,
      status: 'PENDING',
      activeAgentId: 'aline',
    });

    const res = await service.evaluate({ ...INPUT, text: 'Agora não' });

    expect(res).toEqual({ skipLegacyRouting: true, skipChatbot: true, skipAi: true });
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        content: { text: expect.stringContaining('Sem problemas, Maria!') },
        senderName: 'Aline',
      }),
    });
    expect(queue.add).toHaveBeenCalledWith(
      'send-outbound',
      expect.objectContaining({ contactExternalId: '5511988887777' }),
      expect.any(Object),
    );
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: expect.objectContaining({
        aiEnabled: false,
        aiUntilHandoff: false,
        activeAgentId: null,
        status: 'CLOSED',
        metadata: { websiteLead: expect.objectContaining({ submissionId: 'sub-1', declinedAt: expect.any(String) }) },
      }),
    });
    expect(prisma.leadSubmission.updateMany).toHaveBeenCalledWith({
      where: { followupConversationId: 'conv-1', followupStatus: 'SENT' },
      data: { followupStatus: 'DECLINED', followupReason: 'agora_nao' },
    });
  });

  it('"Agora não" em conversa do vendedor da carteira: desliga a IA mas não encerra', async () => {
    const { service, prisma } = make({
      aiUntilHandoff: true,
      metadata: FOLLOWUP_META,
      assignedToId: 'renata',
      status: 'OPEN',
      activeAgentId: 'aline',
    });
    await service.evaluate({ ...INPUT, text: 'agora nao' });
    const data = prisma.conversation.update.mock.calls[0][0].data;
    expect(data.status).toBeUndefined();
    expect(data.aiEnabled).toBe(false);
  });

  it('"Agora não" escrito no meio de outra frase não é recusa', async () => {
    const { service, prisma } = make({ aiUntilHandoff: true, metadata: FOLLOWUP_META, assignedToId: null, status: 'PENDING' });
    const res = await service.evaluate({ ...INPUT, text: 'agora não posso, amanhã sim' });
    expect(res.skipAi).toBe(false);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('conversa nova de quem preencheu o site há pouco ganha a etiqueta Site', async () => {
    const { service, prisma } = make(
      { aiUntilHandoff: false, metadata: {}, assignedToId: null, status: 'PENDING' },
      { formKind: 'main' },
    );
    expect(await service.evaluate({ ...INPUT, conversationIsNewOrReopened: true })).toEqual({
      skipLegacyRouting: false,
      skipChatbot: false,
      skipAi: false,
    });
    expect(prisma.conversationTag.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: { conversationId: 'conv-1', tagId: 'tag-site' } }),
    );
  });
});
