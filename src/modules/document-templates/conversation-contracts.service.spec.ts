import { BadRequestException, ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConversationGuardService } from '../acceptances/conversation-guard.service';
import { ConversationContractsService, ContractActor, contractLinkMessage } from './conversation-contracts.service';
import { DocumentTemplatesService } from './document-templates.service';

const AGENT: ContractActor = { organizationId: 'org-1', role: 'AGENT', userId: 'u-1', channelAccess: new Set(['ch-1']) };

function tpl(over: Record<string, unknown> = {}) {
  return { id: 'tpl-1', organizationId: 'org-1', title: 'Contrato de Viagem', category: 'Viagem', audience: 'CLIENT',
    body: 'Eu, [Nome do Cliente], CPF [CPF do Cliente].', isActive: true, ...over };
}

function setup(row: any = tpl()) {
  const prisma = {
    documentTemplate: {
      findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
        where.id === row.id && where.organizationId === row.organizationId ? row : null),
    },
  } as any;
  const conversationAccess = {
    assertConversationAccess: jest.fn().mockResolvedValue({ id: 'conv-1', contactId: 'ct-1', channelId: 'ch-1' }),
  } as any;
  const templates = new DocumentTemplatesService(prisma, conversationAccess, {} as any);
  const acceptance = { id: 'acc-1', kind: 'CONTRACT', title: 'Contrato de Viagem', status: 'PENDING', items: [],
    signedAt: null, signerName: null, signerIp: null, signerUserAgent: null, pdfKey: null, createdAt: new Date(), expiresAt: new Date() };
  const acceptances = {
    createForConversation: jest.fn().mockResolvedValue({ acceptance, link: 'https://x.test/aceite/tok' }),
    listContractsForConversation: jest.fn().mockResolvedValue([]),
    findContractInConversation: jest.fn().mockResolvedValue({ ...acceptance }),
    resend: jest.fn().mockResolvedValue({ acceptance: { ...acceptance, expiresAt: new Date() }, link: 'https://x.test/aceite/tok' }),
    toStatusView: jest.fn().mockImplementation((a: any) => ({ id: a.id, kind: a.kind, title: a.title, status: a.status })),
  } as any;
  const messages = { send: jest.fn().mockResolvedValue({ id: 'msg-1' }) } as any;
  const svc = new ConversationContractsService(templates, acceptances, new ConversationGuardService(conversationAccess), messages);
  return { svc, acceptances, messages, conversationAccess };
}

const filled = { '[Nome do Cliente]': 'Ana', '[CPF do Cliente]': '123' };

describe('ConversationContractsService.create', () => {
  it('cria o aceite CONTRACT com o texto preenchido e manda o link na conversa', async () => {
    const { svc, acceptances, messages } = setup();
    const out = await svc.create(AGENT, 'conv-1', { templateId: 'tpl-1', values: filled, expiresInDays: 10 });

    expect(acceptances.createForConversation).toHaveBeenCalledWith('org-1', 'conv-1', {
      kind: 'CONTRACT', title: 'Contrato de Viagem', templateId: 'tpl-1', items: [],
      termText: 'Eu, Ana, CPF 123.', createdById: 'u-1', expiresInDays: 10,
    });
    expect(messages.send).toHaveBeenCalledWith(
      { conversationId: 'conv-1', type: 'TEXT', content: { text: 'Segue o contrato *Contrato de Viagem* para leitura e aceite: https://x.test/aceite/tok' } },
      'u-1', 'org-1', AGENT.channelAccess, 'AGENT', { automated: true },
    );
    expect(out).toEqual(expect.objectContaining({
      id: 'acc-1', kind: 'CONTRACT', title: 'Contrato de Viagem', link: 'https://x.test/aceite/tok',
      send: { queued: true, messageId: 'msg-1' },
    }));
  });

  it('campo sem valor → 422 com a lista de faltantes e nada é criado', async () => {
    const { svc, acceptances, messages } = setup();
    const err = await svc.create(AGENT, 'conv-1', { templateId: 'tpl-1', values: { '[Nome do Cliente]': 'Ana', '[CPF do Cliente]': ' ' } })
      .catch((e) => e);
    expect(err).toBeInstanceOf(UnprocessableEntityException);
    expect((err as UnprocessableEntityException).getResponse()).toEqual(expect.objectContaining({ missing: ['[CPF do Cliente]'] }));
    expect(acceptances.createForConversation).not.toHaveBeenCalled();
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('modelo INTERNAL é recusado (ADMIN) e invisível (AGENT)', async () => {
    const admin = { ...AGENT, role: 'ADMIN' as const, channelAccess: 'ALL' as const };
    await expect(setup(tpl({ audience: 'INTERNAL' })).svc.create(admin, 'conv-1', { templateId: 'tpl-1', values: filled }))
      .rejects.toBeInstanceOf(BadRequestException);
    await expect(setup(tpl({ audience: 'INTERNAL' })).svc.create(AGENT, 'conv-1', { templateId: 'tpl-1', values: filled }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('modelo inativo é recusado mesmo para ADMIN', async () => {
    const admin = { ...AGENT, role: 'ADMIN' as const };
    await expect(setup(tpl({ isActive: false })).svc.create(admin, 'conv-1', { templateId: 'tpl-1', values: filled }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('conversa de outra org / sem acesso → 404 antes de criar qualquer coisa', async () => {
    const { svc, conversationAccess, acceptances } = setup();
    conversationAccess.assertConversationAccess.mockRejectedValue(new NotFoundException('Conversation not found'));
    await expect(svc.create(AGENT, 'conv-x', { templateId: 'tpl-1', values: filled })).rejects.toBeInstanceOf(NotFoundException);
    expect(acceptances.createForConversation).not.toHaveBeenCalled();
  });

  it('canal sem acesso do AGENT → 404 antes de criar', async () => {
    const { svc, acceptances } = setup();
    const semCanal = { ...AGENT, channelAccess: new Set(['outro']) };
    await expect(svc.create(semCanal, 'conv-1', { templateId: 'tpl-1', values: filled })).rejects.toBeInstanceOf(NotFoundException);
    expect(acceptances.createForConversation).not.toHaveBeenCalled();
  });

  it('modelo de outra org → 404', async () => {
    await expect(setup(tpl({ organizationId: 'org-2' })).svc.create(AGENT, 'conv-1', { templateId: 'tpl-1', values: filled }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('falha no envio não derruba: contrato fica criado e send traz o motivo', async () => {
    const { svc, messages } = setup();
    messages.send.mockRejectedValue(new NotFoundException('Contact channel not found'));
    const out = await svc.create(AGENT, 'conv-1', { templateId: 'tpl-1', values: filled });
    expect(out.send).toEqual({ queued: false, error: 'Conversa ou canal do cliente não encontrado.' });
    expect(out.id).toBe('acc-1');
  });
});

describe('ConversationContractsService.list', () => {
  it('confere acesso à conversa e lista só os contratos da org', async () => {
    const { svc, acceptances, conversationAccess } = setup();
    await svc.list(AGENT, 'conv-1');
    expect(conversationAccess.assertConversationAccess).toHaveBeenCalledWith('conv-1', 'org-1', 'AGENT', 'u-1', { allowParticipant: true });
    expect(acceptances.listContractsForConversation).toHaveBeenCalledWith('org-1', 'conv-1');
  });
});

describe('contractLinkMessage', () => {
  it('monta o texto do link', () => {
    expect(contractLinkMessage('X', 'L')).toBe('Segue o contrato *X* para leitura e aceite: L');
  });
});

describe('ConversationContractsService.resend', () => {
  it('confere a conversa, busca o contrato dela, renova e reenvia a mesma mensagem', async () => {
    const { svc, acceptances, messages, conversationAccess } = setup();
    const out = await svc.resend(AGENT, 'conv-1', 'acc-1');
    expect(conversationAccess.assertConversationAccess).toHaveBeenCalledWith('conv-1', 'org-1', 'AGENT', 'u-1', { allowParticipant: true });
    expect(acceptances.findContractInConversation).toHaveBeenCalledWith('org-1', 'conv-1', 'acc-1');
    expect(acceptances.resend).toHaveBeenCalledWith('org-1', 'acc-1');
    expect(messages.send.mock.calls[0][0].content.text)
      .toBe('Segue o contrato *Contrato de Viagem* para leitura e aceite: https://x.test/aceite/tok');
    expect(out).toEqual(expect.objectContaining({ id: 'acc-1', kind: 'CONTRACT', link: 'https://x.test/aceite/tok', send: { queued: true, messageId: 'msg-1' } }));
  });

  it('contrato assinado → 409 e nada é renovado nem enviado', async () => {
    const { svc, acceptances, messages } = setup();
    acceptances.findContractInConversation.mockResolvedValue({ id: 'acc-1', status: 'SIGNED', title: 'X' });
    await expect(svc.resend(AGENT, 'conv-1', 'acc-1')).rejects.toBeInstanceOf(ConflictException);
    expect(acceptances.resend).not.toHaveBeenCalled();
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('conversa sem acesso → 404 antes de procurar o contrato', async () => {
    const { svc, acceptances, conversationAccess } = setup();
    conversationAccess.assertConversationAccess.mockRejectedValue(new NotFoundException());
    await expect(svc.resend(AGENT, 'conv-x', 'acc-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(acceptances.findContractInConversation).not.toHaveBeenCalled();
  });

  it('contrato de outra conversa/entrega → 404 (propagado do serviço de aceite)', async () => {
    const { svc, acceptances, messages } = setup();
    acceptances.findContractInConversation.mockRejectedValue(new NotFoundException('Contrato não encontrado.'));
    await expect(svc.resend(AGENT, 'conv-1', 'acc-delivery')).rejects.toBeInstanceOf(NotFoundException);
    expect(messages.send).not.toHaveBeenCalled();
  });
});
