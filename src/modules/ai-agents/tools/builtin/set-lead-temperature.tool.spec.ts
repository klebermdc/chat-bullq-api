import { SetLeadTemperatureTool } from './set-lead-temperature.tool';

function make() {
  const prisma = {
    conversation: { update: jest.fn().mockResolvedValue({ id: 'c1', temperature: 3 }) },
  } as any;
  const ctx = {
    organizationId: 'org1',
    conversationId: 'c1',
    contactId: 'ct1',
    channelId: 'ch1',
    agentId: 'a1',
    runId: 'r1',
  } as any;
  return { tool: new SetLeadTemperatureTool(prisma), prisma, ctx };
}

describe('SetLeadTemperatureTool', () => {
  it('grava a temperatura (1-3) na conversa', async () => {
    const { tool, prisma, ctx } = make();
    const res = await tool.execute({ temperature: 3 }, ctx);
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { temperature: 3 },
    });
    expect(res.output).toMatchObject({ ok: true, temperature: 3 });
  });

  it('aceita string numérica "2"', async () => {
    const { tool, prisma, ctx } = make();
    const res = await tool.execute({ temperature: '2' } as any, ctx);
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { temperature: 2 },
    });
    expect(res.output).toMatchObject({ ok: true, temperature: 2 });
  });

  it('rejeita valor fora de 1-3 e não grava', async () => {
    const { tool, prisma, ctx } = make();
    const res = await tool.execute({ temperature: 5 }, ctx);
    expect(res.output).toMatchObject({ ok: false });
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });
});
