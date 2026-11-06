import { SendCheckRecorder } from './send-check.recorder';

const ROW = {
  organizationId: 'org-1',
  conversationId: 'conv-1',
  runId: 'run-1',
  agentId: 'agent-1',
  check: 'commercial' as const,
  verdict: 'blocked' as const,
  sentence: 'O ingresso custa R$ 699',
};

describe('SendCheckRecorder', () => {
  it('grava a linha em ai_send_checks', async () => {
    const prisma = { aiSendCheck: { create: jest.fn().mockResolvedValue({}) } } as any;

    await new SendCheckRecorder(prisma).record(ROW);

    expect(prisma.aiSendCheck.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ check: 'commercial', verdict: 'blocked', runId: 'run-1' }),
    });
  });

  it('corta a frase longa', async () => {
    const prisma = { aiSendCheck: { create: jest.fn().mockResolvedValue({}) } } as any;

    await new SendCheckRecorder(prisma).record({ ...ROW, sentence: 'x'.repeat(5000) });

    expect(prisma.aiSendCheck.create.mock.calls[0][0].data.sentence).toHaveLength(1000);
  });

  it('falha do banco nunca lança', async () => {
    const prisma = { aiSendCheck: { create: jest.fn().mockRejectedValue(new Error('db fora')) } } as any;

    await expect(new SendCheckRecorder(prisma).record(ROW)).resolves.toBeUndefined();
  });
});
