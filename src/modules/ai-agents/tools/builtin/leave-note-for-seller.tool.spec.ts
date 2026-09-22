import { LeaveNoteForSellerTool } from './leave-note-for-seller.tool';

const CTX = {
  organizationId: 'org-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  channelId: 'ch-1',
  agentId: 'agent-aline',
  runId: 'run-1',
};

function make() {
  const saved = { id: 'msg-1' };
  const prisma = {
    message: { create: jest.fn().mockResolvedValue(saved) },
  } as any;
  const realtime = { emitToChannel: jest.fn(), emitToConversation: jest.fn() } as any;
  return { tool: new LeaveNoteForSellerTool(prisma, realtime), prisma, realtime, saved };
}

describe('LeaveNoteForSellerTool', () => {
  it('grava o recado como mensagem interna da conversa, que não vai para o cliente', async () => {
    const { tool, prisma, realtime, saved } = make();

    const result = await tool.execute({ summary: '  Quer orçamento de ingressos para 4 pessoas em dezembro.  ' }, CTX);

    expect(result.output).toEqual({ ok: true });
    const { data } = prisma.message.create.mock.calls[0][0];
    expect(data).toMatchObject({
      conversationId: 'conv-1',
      type: 'SYSTEM',
      status: 'SENT',
      content: {
        text: '📋 Recado da Aline (plantão): Quer orçamento de ingressos para 4 pessoas em dezembro.',
        onCallNote: true,
      },
      metadata: { aiAgentId: 'agent-aline', runId: 'run-1' },
    });
    expect(data.senderId).toBeUndefined();
    expect(realtime.emitToConversation).toHaveBeenCalledWith('conv-1', 'message:new', { message: saved });
  });

  it('recusa recado vazio', async () => {
    const { tool, prisma } = make();

    const result = await tool.execute({ summary: '   ' }, CTX);

    expect(result.output).toEqual({ ok: false, error: expect.any(String) });
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});
