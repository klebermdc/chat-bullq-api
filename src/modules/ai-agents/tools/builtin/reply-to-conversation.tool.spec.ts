import { ReplyToConversationTool } from './reply-to-conversation.tool';

const CTX = {
  organizationId: 'org-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  channelId: 'ch-1',
  agentId: 'agent-aline',
  runId: 'run-1',
};

function make() {
  const prisma = {
    aiAgent: { findUnique: jest.fn().mockResolvedValue({ name: 'Aline' }) },
    contactChannel: { findFirst: jest.fn().mockResolvedValue({ externalId: '5511999990000' }) },
    conversation: {
      findUnique: jest.fn().mockResolvedValue({ organization: { allowedUrlDomains: ['orlandofastpass.com.br'] } }),
      update: jest.fn().mockResolvedValue({}),
    },
    message: { create: jest.fn().mockResolvedValue({ id: 'msg-1' }) },
  } as any;
  const realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn() } as any;
  const queue = { add: jest.fn().mockResolvedValue({}) } as any;
  return { tool: new ReplyToConversationTool(prisma, realtime, queue), prisma, queue };
}

describe('ReplyToConversationTool — telefone de emergência', () => {
  it('bloqueia o número de emergência escrito pelo modelo', async () => {
    const { tool, queue } = make();

    const result = await tool.execute({ text: 'Liga no nosso plantão: 11 5194-1724' }, CTX);

    expect(result.output).toMatchObject({ ok: false, error: 'emergency_phone_blocked' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('deliver manda a mensagem montada pelo sistema, com link fora da lista de domínios', async () => {
    const { tool, prisma, queue } = make();

    const result = await tool.deliver('Toque aqui: https://wa.me/551151941724', CTX, { emergencyContact: true });

    expect(result).toEqual({ output: { ok: true, messageId: 'msg-1' }, finalAction: 'REPLIED' });
    expect(prisma.message.create.mock.calls[0][0].data.metadata).toEqual({
      emergencyContact: true,
      aiAgentId: 'agent-aline',
      runId: 'run-1',
    });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('resposta comum continua passando', async () => {
    const { tool, queue } = make();

    const result = await tool.execute({ text: 'O Pedro volta amanhã às 9h.' }, CTX);

    expect(result.output).toMatchObject({ ok: true });
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});
