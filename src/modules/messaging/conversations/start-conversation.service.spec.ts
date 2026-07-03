import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ChannelType, MessageContentType, MessageDirection, MessageStatus } from '@prisma/client';
import { StartConversationService } from './start-conversation.service';

describe('StartConversationService.start', () => {
  function make(opts: { channelType?: ChannelType; existingCC?: any; existingContact?: any } = {}) {
    const channel = { id: 'ch1', organizationId: 'org1', type: opts.channelType ?? ChannelType.WHATSAPP_ZAPPFY, deletedAt: null };
    const prisma = {
      channel: { findFirst: jest.fn().mockResolvedValue(channel) },
      contactChannel: { findUnique: jest.fn().mockResolvedValue(opts.existingCC ?? null), create: jest.fn().mockResolvedValue({ id: 'cc-new', contactId: 'c-linked' }) },
      contact: { findFirst: jest.fn().mockResolvedValue(opts.existingContact ?? null), findUnique: jest.fn().mockResolvedValue(opts.existingContact ?? null), create: jest.fn().mockResolvedValue({ id: 'c-new' }) },
      message: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
      conversation: { update: jest.fn().mockResolvedValue({}) },
    } as any;
    const resolver = { resolve: jest.fn().mockResolvedValue({ conversationId: 'conv1' }) } as any;
    const queue = { add: jest.fn().mockResolvedValue({}) } as any;
    return { svc: new StartConversationService(prisma, resolver, queue), prisma, resolver, queue };
  }
  const creator = { userOrganizationId: 'uo1', role: 'OWNER' as any };

  it('recusa canal WhatsApp Oficial', async () => {
    const { svc } = make({ channelType: ChannelType.WHATSAPP_OFFICIAL });
    await expect(svc.start('org1', { channelId: 'ch1', phone: '5511982015967', message: 'oi' }, 'ALL', creator)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('recusa quando nao ha phone nem contactId', async () => {
    const { svc } = make();
    await expect(svc.start('org1', { channelId: 'ch1', message: 'oi' } as any, 'ALL', creator)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('cria contato novo, resolve conversa e enfileira a mensagem', async () => {
    const { svc, prisma, resolver, queue } = make({ existingCC: null, existingContact: null });
    const res = await svc.start('org1', { channelId: 'ch1', phone: '+55 (11) 98201-5967', name: 'João', message: 'Olá!' }, 'ALL', creator);
    expect(res).toEqual({ conversationId: 'conv1' });
    expect(prisma.contact.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org1', phone: '5511982015967' }) }));
    expect(resolver.resolve).toHaveBeenCalledWith('org1', 'ch1', 'c-new');
    expect(prisma.message.create).toHaveBeenCalledWith({ data: expect.objectContaining({ conversationId: 'conv1', direction: MessageDirection.OUTBOUND, type: MessageContentType.TEXT, content: { text: 'Olá!' }, status: MessageStatus.QUEUED }) });
    expect(queue.add).toHaveBeenCalledWith('send-outbound', expect.objectContaining({ messageId: 'm1', channelId: 'ch1', contactExternalId: '5511982015967@s.whatsapp.net', message: { type: MessageContentType.TEXT, content: { text: 'Olá!' } } }), expect.any(Object));
  });

  it('recusa quando o usuario nao tem acesso ao canal (ChannelAccess)', async () => {
    const { svc } = make();
    const noAccess = new Set<string>(['outro-canal']);
    await expect(
      svc.start('org1', { channelId: 'ch1', phone: '5511982015967', message: 'oi' }, noAccess, creator),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
