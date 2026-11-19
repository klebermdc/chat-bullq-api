import { BadRequestException, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { CopilotConsultService } from './copilot-consult.service';

const ALINE = {
  id: 'aline',
  name: 'Aline',
  kind: 'ORCHESTRATOR',
  systemPrompt: 'Você é a Aline. Nunca negocie preço.',
  operationalContext: null,
  createdAt: new Date('2026-01-01'),
  modelId: 'MiniMax-M2',
  _count: { channels: 2 },
};

const def = (name: string) => ({ name, description: name, parameters: {} });

function makeService() {
  const prisma = {
    aiAgent: { findMany: jest.fn().mockResolvedValue([ALINE]) },
    aiAgentKnowledge: {
      findMany: jest.fn().mockResolvedValue([{ question: 'precisa de visto?', content: 'EUA sim', category: 'visto' }]),
    },
    aiAgentSkill: { findMany: jest.fn().mockResolvedValue([]) },
    contact: { findUnique: jest.fn().mockResolvedValue({ name: 'Maria', phone: '5511' }) },
    message: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
  };
  const llm = { complete: jest.fn() };
  const builtin = { execute: jest.fn().mockResolvedValue({ output: { pedidos: 1 } }) };
  const registry = {
    getLlmDefinitionsForKind: jest
      .fn()
      .mockReturnValue([def('replyToConversation'), def('lookupOffering'), def('checkPurchase'), def('transferToHuman')]),
    get: jest.fn().mockReturnValue(builtin),
  };
  const http = { execute: jest.fn() };
  const access = {
    assertConversationAccess: jest.fn().mockResolvedValue({ id: 'c1', contactId: 'ct1', channelId: 'ch1' }),
  };
  const service = new CopilotConsultService(prisma as any, llm as any, registry as any, http as any, access as any);
  return { service, prisma, llm, registry, builtin, http, access };
}

const finalAnswer = (content: string) => ({ stopReason: 'end', message: { role: 'assistant', content } });
const toolCall = (name: string) => ({
  stopReason: 'tool_calls',
  message: { role: 'assistant', content: '', toolCalls: [{ id: 't1', name, arguments: {} }] },
});
const VENDEDOR = { id: 'u1', role: OrgRole.AGENT };

describe('CopilotConsultService', () => {
  it('sem IA de atendimento configurada, avisa em vez de responder', async () => {
    const { service, prisma } = makeService();
    prisma.aiAgent.findMany.mockResolvedValue([]);
    await expect(service.consult('org1', VENDEDOR, { text: 'oi' })).rejects.toThrow(BadRequestException);
  });

  it('usa o conhecimento da Aline e devolve a sugestão separada', async () => {
    const { service, llm } = makeService();
    llm.complete.mockResolvedValue(
      finalAnswer('<think>hmm</think>Para EUA precisa.\nSUGESTÃO PARA O CLIENTE:\nOi! Precisa de visto sim.'),
    );
    const out = await service.consult('org1', VENDEDOR, { text: 'precisa de visto?' });
    expect(out).toEqual({ reply: 'Para EUA precisa.', suggestion: 'Oi! Precisa de visto sim.' });
    const req = llm.complete.mock.calls[0][0];
    expect(req.modelId).toBe('MiniMax-M2');
    expect(req.messages[0].content).toContain('Você é a Aline.');
    expect(req.messages[0].content).toContain('precisa de visto?');
  });

  it('sem conversa, oferece só o catálogo; nunca as ferramentas que agem', async () => {
    const { service, llm } = makeService();
    llm.complete.mockResolvedValue(finalAnswer('ok'));
    await service.consult('org1', VENDEDOR, { text: 'preço do ingresso?' });
    expect(llm.complete.mock.calls[0][0].tools.map((t: { name: string }) => t.name)).toEqual(['lookupOffering']);
  });

  it('confere o acesso à conversa antes de gastar com a IA', async () => {
    const { service, llm, access } = makeService();
    access.assertConversationAccess.mockRejectedValue(new NotFoundException());
    await expect(service.consult('org1', VENDEDOR, { text: 'e aí?', conversationId: 'alheia' })).rejects.toThrow(
      NotFoundException,
    );
    expect(access.assertConversationAccess).toHaveBeenCalledWith('alheia', 'org1', OrgRole.AGENT, 'u1', {
      allowParticipant: true,
    });
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('com conversa, leva as mensagens e consulta a compra do cliente', async () => {
    const { service, prisma, llm, builtin } = makeService();
    prisma.message.findMany.mockResolvedValue([
      { id: 'm1', direction: 'INBOUND', senderName: null, content: { text: 'já comprei?' }, createdAt: new Date() },
    ]);
    llm.complete.mockResolvedValueOnce(toolCall('checkPurchase')).mockResolvedValueOnce(finalAnswer('Comprou 1 pedido.'));
    const out = await service.consult('org1', VENDEDOR, { text: 'ele já comprou?', conversationId: 'c1', messageId: 'm1' });
    expect(out.reply).toBe('Comprou 1 pedido.');
    expect(llm.complete.mock.calls[0][0].messages[0].content).toContain('Cliente (Maria): já comprei?  ⟵ MENSAGEM EM FOCO');
    expect(builtin.execute).toHaveBeenCalledWith({}, expect.objectContaining({ conversationId: 'c1', contactId: 'ct1' }));
  });

  it('recusa ferramenta fora da lista mesmo se o modelo tentar chamar', async () => {
    const { service, llm, registry } = makeService();
    llm.complete.mockResolvedValueOnce(toolCall('replyToConversation')).mockResolvedValueOnce(finalAnswer('feito'));
    await service.consult('org1', VENDEDOR, { text: 'manda pra ela' });
    expect(registry.get).not.toHaveBeenCalled();
    const toolMsg = llm.complete.mock.calls[1][0].messages.find((m: { role: string }) => m.role === 'tool');
    expect(toolMsg.content).toContain('indisponível no modo consulta');
  });

  it('só oferece skill personalizada de leitura (HTTP GET)', async () => {
    const { service, prisma, llm } = makeService();
    const skill = (name: string, source: string, httpMethod: string) => ({
      skill: {
        name, description: name, parameters: {}, source, httpMethod, isActive: true, deletedAt: null,
        promptInstructions: `use ${name}`, tool: { isActive: true, deletedAt: null },
      },
    });
    prisma.aiAgentSkill.findMany.mockResolvedValue([
      skill('buscarHotel', 'HTTP', 'GET'),
      skill('criarLead', 'HTTP', 'POST'),
      skill('vendasDoMes', 'SQL', 'GET'),
    ]);
    llm.complete.mockResolvedValue(finalAnswer('ok'));
    await service.consult('org1', VENDEDOR, { text: 'hotel?' });
    const req = llm.complete.mock.calls[0][0];
    expect(req.tools.map((t: { name: string }) => t.name)).toEqual(['lookupOffering', 'buscarHotel']);
    expect(req.messages[0].content).toContain('use buscarHotel');
    expect(req.messages[0].content).not.toContain('use criarLead');
  });

  it('não oferece skill que pede aprovação', async () => {
    const { service, prisma, llm } = makeService();
    llm.complete.mockResolvedValue(finalAnswer('ok'));
    await service.consult('org1', VENDEDOR, { text: 'oi' });
    expect(prisma.aiAgentSkill.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { agentId: 'aline', requiresApproval: false } }),
    );
  });

  it('sem conversa, tira a skill que usa dados do contato; com conversa, oferece', async () => {
    const { service, prisma, llm } = makeService();
    prisma.aiAgentSkill.findMany.mockResolvedValue([
      {
        skill: {
          name: 'pedidosDoContato', description: 'x', parameters: {}, source: 'HTTP', httpMethod: 'GET',
          httpPath: '/pedidos/{{ ctx.contactId }}', isActive: true, deletedAt: null, promptInstructions: null,
          tool: { isActive: true, deletedAt: null, httpBaseUrl: 'https://api' },
        },
      },
    ]);
    llm.complete.mockResolvedValue(finalAnswer('ok'));
    await service.consult('org1', VENDEDOR, { text: 'oi' });
    expect(llm.complete.mock.calls[0][0].tools.map((t: { name: string }) => t.name)).toEqual(['lookupOffering']);
    await service.consult('org1', VENDEDOR, { text: 'oi', conversationId: 'c1' });
    expect(llm.complete.mock.calls[1][0].tools.map((t: { name: string }) => t.name)).toContain('pedidosDoContato');
  });

  it('com print, manda a imagem junto da pergunta', async () => {
    const { service, llm } = makeService();
    llm.complete.mockResolvedValue(finalAnswer('No print o total é R$ 1.200.'));
    await service.consult('org1', VENDEDOR, { text: 'quanto deu?', image: { mediaType: 'image/png', data: 'AAAA' } });
    const user = llm.complete.mock.calls[0][0].messages.find((m: { role: string }) => m.role === 'user');
    expect(user.content).toEqual([
      { type: 'text', text: 'quanto deu?' },
      { type: 'image', base64: { mediaType: 'image/png', data: 'AAAA' } },
    ]);
  });
});
