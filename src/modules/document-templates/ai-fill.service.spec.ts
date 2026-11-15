import { BadGatewayException, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConversationGuardService, ConversationActor } from '../acceptances/conversation-guard.service';
import { AiFillService } from './ai-fill.service';

const AGENT: ConversationActor = { organizationId: 'org-1', role: 'AGENT', userId: 'u-1', channelAccess: new Set(['ch-1']) };
const BODY = 'Eu, [Nome do Cliente], CPF [CPF do Cliente], em [Dia]. Total [Valor Total] ([Valor Total por Extenso]). Destino [Destino].';

function setup(llmText = '<think>{"rascunho": true}</think>Aqui: {"[CPF do Cliente]": " 123.456.789-00 ", "[Valor Total]": "R$ 8.500,00", "[Dia]": "1", "[Valor Total por Extenso]": "oito", "[Hacker]": "x"}') {
  const template = { id: 'tpl-1', title: 'Contrato Disney', body: BODY };
  const prisma = {
    message: {
      // Como o banco devolve: mais nova primeiro (orderBy desc).
      findMany: jest.fn().mockResolvedValue([
        { direction: 'INBOUND', content: { text: 'É 123.456.789-00' }, metadata: {} },
        { direction: 'OUTBOUND', content: { text: 'Pode mandar o CPF?' }, metadata: {} },
      ]),
    },
  } as any;
  const llm = {
    complete: jest.fn().mockResolvedValue({
      message: { role: 'assistant', content: llmText },
      stopReason: 'stop',
      usage: { costUsd: 0 },
      rawModelId: 'm',
    }),
  } as any;
  const templates = { findVisible: jest.fn().mockResolvedValue(template) } as any;
  const conversationAccess = {
    assertConversationAccess: jest.fn().mockResolvedValue({ id: 'conv-1', contactId: 'ct-1', channelId: 'ch-1' }),
  } as any;
  const svc = new AiFillService(prisma, llm, templates, new ConversationGuardService(conversationAccess));
  return { svc, prisma, llm, templates, conversationAccess };
}

describe('AiFillService.fill', () => {
  it('sem texto e sem conversa → 400 antes de qualquer coisa', async () => {
    const { svc, templates, llm } = setup();
    await expect(svc.fill(AGENT, 'tpl-1', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.fill(AGENT, 'tpl-1', { conversationId: 'conv-1' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.fill(AGENT, 'tpl-1', { text: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    expect(templates.findVisible).not.toHaveBeenCalled();
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('lê a conversa (guarda + últimas 80, mais antiga primeiro), filtra a resposta e calcula o extenso', async () => {
    const { svc, prisma, llm, conversationAccess } = setup();
    const out = await svc.fill(AGENT, 'tpl-1', { conversationId: 'conv-1', useConversation: true });

    expect(conversationAccess.assertConversationAccess).toHaveBeenCalledWith('conv-1', 'org-1', 'AGENT', 'u-1', { allowParticipant: true });
    expect(prisma.message.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ conversationId: 'conv-1', revokedAt: null }),
      orderBy: { createdAt: 'desc' },
      take: 80,
    }));
    const user = llm.complete.mock.calls[0][0].messages[1].content as string;
    expect(user).toContain('Cliente: É 123.456.789-00');
    expect(user.indexOf('Atendente: Pode mandar')).toBeLessThan(user.indexOf('Cliente: É'));
    expect(user).toContain('- [CPF do Cliente] (CPF)');
    expect(user).not.toContain('- [Dia]');
    expect(user).not.toContain('- [Valor Total por Extenso]');

    expect(out.values).toEqual({
      '[CPF do Cliente]': '123.456.789-00',
      '[Valor Total]': 'R$ 8.500,00',
      '[Valor Total por Extenso]': 'oito mil e quinhentos reais',
    });
    expect(out.filled).toEqual(['[CPF do Cliente]', '[Valor Total]', '[Valor Total por Extenso]']);
  });

  it('só texto colado: não lê mensagens; campos já preenchidos não vão para a IA nem voltam', async () => {
    const { svc, prisma, llm } = setup('{"[Nome do Cliente]": "Outro", "[Destino]": "Orlando"}');
    const out = await svc.fill(AGENT, 'tpl-1', {
      text: 'Destino: Orlando',
      currentValues: { '[Nome do Cliente]': 'Ana', '[CPF do Cliente]': '1', '[Valor Total]': '1.000', '[Valor Total por Extenso]': 'mil reais' },
    });
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    const user = llm.complete.mock.calls[0][0].messages[1].content as string;
    expect(user).not.toContain('- [Nome do Cliente]');
    expect(out.values).toEqual({ '[Destino]': 'Orlando' });
  });

  it('extenso vem do valor que o atendente já digitou, mesmo sem a IA achar nada', async () => {
    const { svc } = setup('{}');
    const out = await svc.fill(AGENT, 'tpl-1', { text: 'nada', currentValues: { '[Valor Total]': 'R$ 1,00' } });
    expect(out.values).toEqual({ '[Valor Total por Extenso]': 'um real' });
  });

  it('LLM falhou ou respondeu sem JSON → 502 com mensagem amigável', async () => {
    const failing = setup();
    failing.llm.complete.mockRejectedValue(new Error('timeout'));
    await expect(failing.svc.fill(AGENT, 'tpl-1', { text: 'x' })).rejects.toBeInstanceOf(BadGatewayException);
    await expect(setup('não sei').svc.fill(AGENT, 'tpl-1', { text: 'x' })).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('conversa sem acesso → 404 e a IA não é chamada', async () => {
    const { svc, conversationAccess, llm, prisma } = setup();
    conversationAccess.assertConversationAccess.mockRejectedValue(new NotFoundException());
    await expect(svc.fill(AGENT, 'tpl-1', { conversationId: 'conv-x', useConversation: true })).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.message.findMany).not.toHaveBeenCalled();
    expect(llm.complete).not.toHaveBeenCalled();
  });

  it('modelo invisível → 404 propagado', async () => {
    const { svc, templates } = setup();
    templates.findVisible.mockRejectedValue(new NotFoundException());
    await expect(svc.fill(AGENT, 'tpl-1', { text: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });
});
