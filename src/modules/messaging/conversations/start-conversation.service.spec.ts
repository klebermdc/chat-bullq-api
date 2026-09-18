import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ChannelType, MessageContentType, MessageDirection, MessageStatus } from '@prisma/client';
import { StartConversationService } from './start-conversation.service';

describe('StartConversationService.start', () => {
  function make(opts: { channelType?: ChannelType; existingCC?: any; existingContact?: any } = {}) {
    const channel = { id: 'ch1', organizationId: 'org1', type: opts.channelType ?? ChannelType.WHATSAPP_ZAPPFY, deletedAt: null };
    const prisma = {
      channel: { findFirst: jest.fn().mockResolvedValue(channel) },
      contactChannel: { findUnique: jest.fn().mockResolvedValue(opts.existingCC ?? null), findFirst: jest.fn().mockResolvedValue(opts.existingCC ?? null), create: jest.fn().mockResolvedValue({ id: 'cc-new', contactId: 'c-linked' }) },
      contact: { findFirst: jest.fn().mockResolvedValue(opts.existingContact ?? null), findUnique: jest.fn().mockResolvedValue(opts.existingContact ?? null), create: jest.fn().mockResolvedValue({ id: 'c-new' }) },
      message: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
      conversation: { update: jest.fn().mockResolvedValue({}) },
    } as any;
    const resolver = { resolve: jest.fn().mockResolvedValue({ conversationId: 'conv1' }) } as any;
    const queue = { add: jest.fn().mockResolvedValue({}) } as any;
    return { svc: new StartConversationService(prisma, resolver, queue), prisma, resolver, queue };
  }
  const creator = { userOrganizationId: 'uo1', role: 'OWNER' as any };

  it('recusa canal WhatsApp Oficial SEM template', async () => {
    const { svc } = make({ channelType: ChannelType.WHATSAPP_OFFICIAL });
    await expect(svc.start('org1', { channelId: 'ch1', phone: '5511982015967', message: 'oi' }, 'ALL', creator)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('canal WhatsApp Oficial COM template cria conversa e enfileira mensagem TEMPLATE', async () => {
    const { svc, prisma, resolver, queue } = make({ channelType: ChannelType.WHATSAPP_OFFICIAL });
    const template = {
      name: 'reengajamento',
      language: { code: 'pt_BR' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: 'João' }] }],
    };
    const res = await svc.start('org1', { channelId: 'ch1', phone: '+55 (11) 98201-5967', name: 'João', template }, 'ALL', creator);
    expect(res).toEqual({ conversationId: 'conv1', contactId: 'c-new' });
    expect(resolver.resolve).toHaveBeenCalledWith('org1', 'ch1', 'c-new');
    // Meta usa só os dígitos como external id (sem @s.whatsapp.net)
    expect(prisma.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: 'conv1', direction: MessageDirection.OUTBOUND, type: MessageContentType.TEMPLATE, content: template, status: MessageStatus.QUEUED }) });
    expect(queue.add).toHaveBeenCalledWith('send-outbound', expect.objectContaining({ messageId: 'm1', channelId: 'ch1', contactExternalId: '5511982015967', message: { type: MessageContentType.TEMPLATE, content: template } }), expect.any(Object));
  });

  it('recusa canal nao-oficial SEM mensagem', async () => {
    const { svc } = make({ channelType: ChannelType.WHATSAPP_ZAPPFY });
    await expect(svc.start('org1', { channelId: 'ch1', phone: '5511982015967' } as any, 'ALL', creator)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa quando nao ha phone nem contactId', async () => {
    const { svc } = make();
    await expect(svc.start('org1', { channelId: 'ch1', message: 'oi' } as any, 'ALL', creator)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cria contato novo, resolve conversa e enfileira a mensagem', async () => {
    const { svc, prisma, resolver, queue } = make({ existingCC: null, existingContact: null });
    const res = await svc.start('org1', { channelId: 'ch1', phone: '+55 (11) 98201-5967', name: 'João', email: 'joao@x.com', notes: 'lead quente', message: 'Olá!' }, 'ALL', creator);
    expect(res).toEqual({ conversationId: 'conv1', contactId: 'c-new' });
    expect(prisma.contact.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org1', phone: '5511982015967', name: 'João', email: 'joao@x.com', notes: 'lead quente' }) }));
    expect(resolver.resolve).toHaveBeenCalledWith('org1', 'ch1', 'c-new');
    expect(prisma.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: 'conv1', direction: MessageDirection.OUTBOUND, type: MessageContentType.TEXT, content: { text: 'Olá!' }, status: MessageStatus.QUEUED }) });
    expect(queue.add).toHaveBeenCalledWith('send-outbound', expect.objectContaining({ messageId: 'm1', channelId: 'ch1', contactExternalId: '5511982015967@s.whatsapp.net', message: { type: MessageContentType.TEXT, content: { text: 'Olá!' } } }), expect.any(Object));
  });

  it('completa o 55 quando o operador digita so DDD + numero', async () => {
    const { svc, queue } = make();
    await svc.start('org1', { channelId: 'ch1', phone: '(11) 98201-5967', message: 'Olá!' }, 'ALL', creator);
    expect(queue.add).toHaveBeenCalledWith('send-outbound', expect.objectContaining({ contactExternalId: '5511982015967@s.whatsapp.net' }), expect.any(Object));
  });

  // O WhatsApp identifica muitos celulares BR sem o 9. Se o cliente já falou
  // com a gente, o canal dele existe na forma sem o 9: reusa e manda pra ela.
  it('reusa o canal do contato gravado sem o 9 e envia para ele', async () => {
    const existingCC = { id: 'cc1', contactId: 'c-antigo', externalId: '551182015967@s.whatsapp.net' };
    const { svc, prisma, queue } = make({ existingCC });
    const res = await svc.start('org1', { channelId: 'ch1', phone: '5511982015967', message: 'Olá!' }, 'ALL', creator);
    expect(res.contactId).toBe('c-antigo');
    expect(prisma.contactChannel.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { channelId: 'ch1', externalId: { in: ['5511982015967@s.whatsapp.net', '551182015967@s.whatsapp.net'] } },
    }));
    expect(prisma.contact.create).not.toHaveBeenCalled();
    expect(queue.add).toHaveBeenCalledWith('send-outbound', expect.objectContaining({ contactExternalId: '551182015967@s.whatsapp.net' }), expect.any(Object));
  });

  it('reusa contato cujo telefone esta gravado sem o 9', async () => {
    const { svc, prisma } = make({ existingContact: { id: 'c-antigo', phone: '551182015967' } });
    const res = await svc.start('org1', { channelId: 'ch1', phone: '5511982015967', message: 'Olá!' }, 'ALL', creator);
    expect(res.contactId).toBe('c-antigo');
    expect(prisma.contact.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ phone: { in: ['5511982015967', '551182015967'] } }),
    }));
    expect(prisma.contact.create).not.toHaveBeenCalled();
  });

  it('recusa quando o usuario nao tem acesso ao canal (ChannelAccess)', async () => {
    const { svc } = make();
    const noAccess = new Set<string>(['outro-canal']);
    await expect(
      svc.start('org1', { channelId: 'ch1', phone: '5511982015967', message: 'oi' }, noAccess, creator),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
