import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentTemplatesService, TemplateActor } from './document-templates.service';
import { ConversationActor, ConversationGuardService } from '../acceptances/conversation-guard.service';

const ADMIN: TemplateActor = { organizationId: 'org-1', role: 'ADMIN', userId: 'u-admin' };
const OWNER: TemplateActor = { organizationId: 'org-1', role: 'OWNER', userId: 'u-owner' };
const AGENT: TemplateActor = { organizationId: 'org-1', role: 'AGENT', userId: 'u-agent' };
/** Ator das rotas com conversa: canais acessíveis entram na guarda. */
const withChannels = (actor: TemplateActor, channels: ConversationActor['channelAccess'] = new Set(['ch-1'])): ConversationActor =>
  ({ ...actor, channelAccess: channels });

function tpl(over: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1', organizationId: 'org-1', title: 'Contrato', category: 'Viagem', audience: 'CLIENT',
    body: 'Eu, [Nome do Cliente], em [Dia] de [Mês] de [Ano]. [CPF do Cliente]', isActive: true,
    sourceRef: null, createdById: null, createdAt: new Date(), updatedAt: new Date(), ...over,
  };
}

function setup(row: any = tpl()) {
  const prisma = {
    documentTemplate: {
      findMany: jest.fn().mockResolvedValue([row]),
      // Simula o filtro por org do banco: outra org = null.
      findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
        row && where.id === row.id && where.organizationId === row.organizationId ? row : null),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ ...tpl(), ...data, id: 'new' })),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...row, ...data })),
    },
    contractSettings: { findUnique: jest.fn().mockResolvedValue({ companyName: 'OFP Ltda', companyDocument: null, companyAddress: null }) },
    contact: { findFirst: jest.fn().mockResolvedValue({ id: 'ct-1', name: 'Ana', phone: '5511', email: null }) },
    organization: { findUnique: jest.fn().mockResolvedValue({ name: 'OFP' }) },
  } as any;
  const conversationAccess = {
    assertConversationAccess: jest.fn().mockResolvedValue({ id: 'conv-1', contactId: 'ct-1', channelId: 'ch-1' }),
  } as any;
  const pdf = { renderDocument: jest.fn().mockResolvedValue(Buffer.from('pdf')) } as any;
  const fieldDefaults = { values: jest.fn().mockResolvedValue({}) } as any;
  const personalData = { findValues: jest.fn().mockResolvedValue({}) } as any;
  const guard = new ConversationGuardService(conversationAccess);
  const svc = new DocumentTemplatesService(prisma, guard, pdf, fieldDefaults, personalData);
  return { prisma, conversationAccess, pdf, fieldDefaults, personalData, svc };
}

describe('DocumentTemplatesService.list', () => {
  it('AGENT lista só CLIENT ativos da própria org, ordenado por categoria e título', async () => {
    const { prisma, svc } = setup();
    const list = await svc.list(AGENT, {});
    expect(prisma.documentTemplate.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', audience: 'CLIENT', isActive: true },
      orderBy: [{ category: 'asc' }, { title: 'asc' }],
    });
    expect(list[0]).toEqual({
      id: 'tpl-1', title: 'Contrato', category: 'Viagem', audience: 'CLIENT', isActive: true,
      placeholders: ['[Nome do Cliente]', '[Dia]', '[Mês]', '[Ano]', '[CPF do Cliente]'],
    });
    expect(list[0]).not.toHaveProperty('body');
  });

  it('AGENT pedindo INTERNAL ou inativos → 403', async () => {
    const { svc } = setup();
    await expect(svc.list(AGENT, { audience: 'INTERNAL' })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.list(AGENT, { includeInactive: true })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('ADMIN vê tudo da org, inclusive inativos quando pede', async () => {
    const { prisma, svc } = setup();
    await svc.list(ADMIN, { includeInactive: true });
    expect(prisma.documentTemplate.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1' });
    await svc.list(OWNER, { audience: 'INTERNAL' });
    expect(prisma.documentTemplate.findMany.mock.calls[1][0].where).toEqual({
      organizationId: 'org-1', audience: 'INTERNAL', isActive: true,
    });
  });
});

describe('DocumentTemplatesService.get / visibilidade', () => {
  it('devolve o corpo para quem pode ver', async () => {
    const { svc } = setup();
    expect((await svc.get(AGENT, 'tpl-1')).body).toContain('[Nome do Cliente]');
  });

  it('AGENT não acha modelo INTERNAL nem inativo (404, não confirma existência)', async () => {
    await expect(setup(tpl({ audience: 'INTERNAL' })).svc.get(AGENT, 'tpl-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup(tpl({ isActive: false })).svc.get(AGENT, 'tpl-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ADMIN vê INTERNAL e inativo', async () => {
    expect((await setup(tpl({ audience: 'INTERNAL', isActive: false })).svc.get(ADMIN, 'tpl-1')).audience).toBe('INTERNAL');
  });

  it('modelo de outra org → 404 mesmo para OWNER', async () => {
    const { svc } = setup(tpl({ organizationId: 'org-2' }));
    await expect(svc.get(OWNER, 'tpl-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DocumentTemplatesService — escrita', () => {
  it('create grava na org do ator e com createdById', async () => {
    const { prisma, svc } = setup();
    await svc.create(ADMIN, { title: 'T', category: 'C', audience: 'INTERNAL', body: 'B' });
    expect(prisma.documentTemplate.create).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', title: 'T', category: 'C', audience: 'INTERNAL', body: 'B', createdById: 'u-admin' },
    });
  });

  it('update/deactivate de modelo de outra org → 404 e não grava', async () => {
    const { prisma, svc } = setup(tpl({ organizationId: 'org-2' }));
    await expect(svc.update(ADMIN, 'tpl-1', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.deactivate(ADMIN, 'tpl-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.documentTemplate.update).not.toHaveBeenCalled();
  });

  it('corpo com mais de 200 campos → 400 na criação e na edição, sem gravar', async () => {
    const { prisma, svc } = setup();
    const body = Array.from({ length: 201 }, (_, i) => `[Campo ${i}]`).join(' ');
    await expect(svc.create(ADMIN, { title: 'T', category: 'C', audience: 'CLIENT', body })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.update(ADMIN, 'tpl-1', { body })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.documentTemplate.create).not.toHaveBeenCalled();
    expect(prisma.documentTemplate.update).not.toHaveBeenCalled();
    const ok = Array.from({ length: 200 }, (_, i) => `[Campo ${i}]`).join(' ');
    await expect(svc.create(ADMIN, { title: 'T', category: 'C', audience: 'CLIENT', body: ok })).resolves.toBeDefined();
  });

  it('deactivate é exclusão suave (isActive=false)', async () => {
    const { prisma, svc } = setup();
    const out = await svc.deactivate(ADMIN, 'tpl-1');
    expect(prisma.documentTemplate.update).toHaveBeenCalledWith({ where: { id: 'tpl-1' }, data: { isActive: false } });
    expect(out.isActive).toBe(false);
  });
});

describe('DocumentTemplatesService.autofill / render / pdf', () => {
  it('autofill com conversa passa pela guarda de acesso e lê o contato na org', async () => {
    const { prisma, conversationAccess, svc } = setup();
    const { values } = await svc.autofill(withChannels(AGENT), 'tpl-1', 'conv-1');
    expect(conversationAccess.assertConversationAccess).toHaveBeenCalledWith('conv-1', 'org-1', 'AGENT', 'u-agent', { allowParticipant: true });
    expect(prisma.contact.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'ct-1', organizationId: 'org-1' } }));
    expect(values['[Nome do Cliente]']).toBe('Ana');
    expect(values['[Dia]']).toEqual(expect.any(String));
    expect(values).not.toHaveProperty('[CPF do Cliente]');
  });

  it('autofill com conversa de outra org/sem acesso propaga o 404', async () => {
    const { conversationAccess, svc } = setup();
    conversationAccess.assertConversationAccess.mockRejectedValue(new NotFoundException('Conversation not found'));
    await expect(svc.autofill(withChannels(AGENT), 'tpl-1', 'conv-x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('autofill sem conversa não consulta contato nem dados pessoais', async () => {
    const { prisma, personalData, svc } = setup();
    await svc.autofill(withChannels(ADMIN), 'tpl-1');
    expect(prisma.contact.findFirst).not.toHaveBeenCalled();
    expect(personalData.findValues).not.toHaveBeenCalled();
  });

  it('autofill devolve origens e grupos; lê dados lembrados do contato da conversa e os da agência', async () => {
    const { personalData, fieldDefaults, svc } = setup(tpl({
      body: '[Cidade], [Dia]. Eu, [Nome do Cliente], CPF [CPF do Cliente], razão [Razão Social da Agência], valor [Valor Total].',
    }));
    fieldDefaults.values.mockResolvedValue({ '[Cidade]': 'São Paulo' });
    personalData.findValues.mockResolvedValue({ '[CPF do Cliente]': '123' });
    const out = await svc.autofill(withChannels(AGENT), 'tpl-1', 'conv-1');
    expect(fieldDefaults.values).toHaveBeenCalledWith('org-1');
    expect(personalData.findValues).toHaveBeenCalledWith('org-1', 'ct-1', expect.any(Array));
    expect(out.values).toEqual(expect.objectContaining({
      '[Cidade]': 'São Paulo', '[Nome do Cliente]': 'Ana', '[CPF do Cliente]': '123', '[Razão Social da Agência]': 'OFP Ltda',
    }));
    expect(out.sources).toEqual({
      '[Cidade]': 'default', '[Dia]': 'date', '[Nome do Cliente]': 'contact', '[CPF do Cliente]': 'saved',
      '[Razão Social da Agência]': 'agency',
    });
    expect(out.groups).toEqual({
      client: ['[Nome do Cliente]', '[CPF do Cliente]'],
      seller: ['[Valor Total]'],
      agency: ['[Cidade]', '[Razão Social da Agência]'],
      auto: ['[Dia]'],
    });
    expect(out).not.toHaveProperty('contactName');
  });

  it('AGENT sem acesso ao canal da conversa → 404 e nenhum dado pessoal é lido', async () => {
    const { prisma, personalData, svc } = setup();
    const err = await svc.autofill(withChannels(AGENT, new Set(['outro-canal'])), 'tpl-1', 'conv-1').catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundException);
    expect(prisma.contact.findFirst).not.toHaveBeenCalled();
    expect(personalData.findValues).not.toHaveBeenCalled();
  });

  it('vendedor incluído (conversa compartilhada) preenche: a guarda libera participante', async () => {
    const { conversationAccess, personalData, svc } = setup();
    personalData.findValues.mockResolvedValue({ '[CPF do Cliente]': '123' });
    const out = await svc.autofill(withChannels(AGENT), 'tpl-1', 'conv-1');
    expect(conversationAccess.assertConversationAccess).toHaveBeenCalledWith('conv-1', 'org-1', 'AGENT', 'u-agent', { allowParticipant: true });
    expect(personalData.findValues).toHaveBeenCalledWith('org-1', 'ct-1', expect.arrayContaining(['[CPF do Cliente]']));
    expect(out.values['[CPF do Cliente]']).toBe('123');
  });

  it('autofill com conversa sem acesso não lê dados pessoais', async () => {
    const { conversationAccess, personalData, svc } = setup();
    conversationAccess.assertConversationAccess.mockRejectedValue(new NotFoundException());
    await expect(svc.autofill(withChannels(AGENT), 'tpl-1', 'conv-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(personalData.findValues).not.toHaveBeenCalled();
  });

  it('render devolve texto e faltantes', async () => {
    const { svc } = setup(tpl({ body: '[A] e [B]' }));
    expect(await svc.render(AGENT, 'tpl-1', { '[A]': 'a' })).toEqual({ text: 'a e [B]', missing: ['[B]'] });
  });

  it('pdf usa o pipeline de PDF com título e nome da org', async () => {
    const { pdf, svc } = setup(tpl({ audience: 'INTERNAL', title: 'Procuração', body: '[A]' }));
    const out = await svc.pdfFor(ADMIN, 'tpl-1', { '[A]': 'x' });
    expect(pdf.renderDocument).toHaveBeenCalledWith({ organizationName: 'OFP', title: 'Procuração', text: 'x' });
    expect(out.title).toBe('Procuração');
  });

  it('AGENT não gera PDF de modelo INTERNAL', async () => {
    const { pdf, svc } = setup(tpl({ audience: 'INTERNAL' }));
    await expect(svc.pdfFor(AGENT, 'tpl-1', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(pdf.renderDocument).not.toHaveBeenCalled();
  });
});
