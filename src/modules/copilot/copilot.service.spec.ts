import { BadRequestException } from '@nestjs/common';
import { CopilotService } from './copilot.service';

function makeService() {
  const prisma = {
    aiAgent: { findFirst: jest.fn() },
    aiAgentSkill: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const llm = { complete: jest.fn() };
  const http = { execute: jest.fn() };
  const sql = { execute: jest.fn() };
  const service = new CopilotService(
    prisma as any,
    llm as any,
    http as any,
    sql as any,
  );
  return { service, prisma, llm, http, sql };
}

describe('CopilotService', () => {
  it('lança BadRequest quando não há agente copiloto configurado', async () => {
    const { service, prisma } = makeService();
    prisma.aiAgent.findFirst.mockResolvedValue(null);
    await expect(service.ask('org1', 'oi')).rejects.toThrow(BadRequestException);
  });

  it('executa uma skill SQL e devolve a resposta final sanitizada', async () => {
    const { service, prisma, llm, sql } = makeService();
    prisma.aiAgent.findFirst.mockResolvedValue({
      id: 'agent1',
      modelId: 'sakana/fugu',
      systemPrompt: 'Você é o Copiloto.',
      temperature: 0.4,
      maxTokens: 2048,
      category: 'copiloto-interno',
      isActive: true,
    });
    prisma.aiAgentSkill.findMany.mockResolvedValue([
      {
        skill: {
          name: 'buscarClientePorTelefone',
          description: 'Busca cliente por telefone.',
          parameters: { type: 'object', properties: {} },
          source: 'SQL',
          isActive: true,
          deletedAt: null,
          promptInstructions: null,
          tool: { id: 't1', source: 'CUSTOM_SQL' },
        },
      },
    ]);
    llm.complete
      .mockResolvedValueOnce({
        stopReason: 'tool_calls',
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'c1',
              name: 'buscarClientePorTelefone',
              arguments: { telefone: '41999' },
            },
          ],
        },
        usage: {},
      })
      .mockResolvedValueOnce({
        stopReason: 'stop',
        message: {
          role: 'assistant',
          content: '<think>hmm</think>É a Ana Souza.',
        },
        usage: {},
      });
    sql.execute.mockResolvedValue({
      output: { ok: true, rows: [{ cliente: 'Ana Souza' }] },
    });

    const res = await service.ask('org1', 'quem é o 41999?');

    expect(sql.execute).toHaveBeenCalledTimes(1);
    const ctxArg = sql.execute.mock.calls[0][3];
    expect(ctxArg.organizationId).toBe('org1');
    expect(res.reply).toBe('É a Ana Souza.');
  });
});
