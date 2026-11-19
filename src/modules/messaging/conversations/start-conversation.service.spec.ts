import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ChannelType, MessageContentType, MessageDirection, MessageStatus } from '@prisma/client';
import { StartConversationService } from './start-conversation.service';

describe('StartConversationService.start', () => {
  function make(opts: { channelType?: ChannelType; existingCC?: any; existingContact?: any; currentOwnerId?: string | null; assignError?: Error } = {}) {
    const channel = { id: 'ch1', organizationId: 'org1', type: opts.channelType ?? ChannelType.WHATSAPP_ZAPPFY, deletedAt: null };
    const prisma = {
      channel: { findFirst: jest.fn().mockResolvedValue(channel) },
      contactChannel: { findUnique: jest.fn().mockResolvedValue(opts.existingCC ?? null), findFirst: jest.fn().mockResolvedValue(opts.existingCC ?? null), create: jest.fn().mockResolvedValue({ id: 'cc-new', contactId: 'c-linked' }) },
      contact: { findFirst: jest.fn().mockResolvedValue(opts.existingContact ?? null), findUnique: jest.fn().mockResolvedValue(opts.existingContact ?? null), create: jest.fn().mockResolvedValue({ id: 'c-new' }) },
      message: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
      conversation: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue({ assignedToId: opts.currentOwnerId ?? null }),
      },
    } as any;
    const resolver = { resolve: jest.fn().mockResolvedValue({ conversationId: 'conv1' }) } as any;
    const queue = { add: jest.fn().mockResolvedValue({}) } as any;
    const fsm = {
      assign: opts.assignError ? jest.fn().mockRejectedValue(opts.assignError) : jest.fn().mockResolvedValue(undefined),
    } as any;
    return { svc: new StartConversationService(prisma, resolver, queue, fsm), prisma, resolver, queue, fsm };
  }
  const creator = { userId: 'u1', userOrganizationId: 'uo1', role: 'AGENT' as any };

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
    expect(res).toEqual({ conversationId: 'conv1', contactId: 'c-new', messageId: 'm1' });
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
    expect(res).toEqual({ conversationId: 'conv1', contactId: 'c-new', messageId: 'm1' });
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

  it('envio automático grava a origem e o texto preenchido do template na mensagem', async () => {
    const { svc, prisma } = make({ channelType: ChannelType.WHATSAPP_OFFICIAL });
    const template = { name: 'lead_site_retorno', language: { code: 'pt_BR' } };
    await svc.start('org1', { channelId: 'ch1', phone: '5511982015967', template }, 'ALL', undefined, {
      source: 'website_lead_followup',
      senderName: 'Aline',
      renderedText: 'Olá! Maria',
    });
    expect(prisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        senderName: 'Aline',
        metadata: { source: 'website_lead_followup', renderedText: 'Olá! Maria' },
      }),
    });
  });

  describe('dono da conversa aberta à mão', () => {
    it('atribui a conversa sem dono a quem colocou o telefone', async () => {
      const { svc, fsm } = make({ channelType: ChannelType.WHATSAPP_OFFICIAL, currentOwnerId: null });
      await svc.start('org1', { channelId: 'ch1', phone: '5511982015967', template: { name: 't' } }, 'ALL', creator);
      expect(fsm.assign).toHaveBeenCalledWith('conv1', 'u1', 'u1', 'manual_start');
    });

    it('atribui antes de enfileirar o envio', async () => {
      const { svc, fsm, queue } = make({ currentOwnerId: null });
      await svc.start('org1', { channelId: 'ch1', phone: '5511982015967', message: 'Olá!' }, 'ALL', creator);
      expect(fsm.assign.mock.invocationCallOrder[0]).toBeLessThan(queue.add.mock.invocationCallOrder[0]);
    });

    it('mantém o dono quando a conversa já é de outro vendedor', async () => {
      const { svc, fsm, queue } = make({ currentOwnerId: 'u-outro' });
      await svc.start('org1', { channelId: 'ch1', phone: '5511982015967', message: 'Olá!' }, 'ALL', creator);
      expect(fsm.assign).not.toHaveBeenCalled();
      expect(queue.add).toHaveBeenCalled();
    });

    it('não reatribui quando a conversa já é de quem enviou', async () => {
      const { svc, fsm } = make({ currentOwnerId: 'u1' });
      await svc.start('org1', { channelId: 'ch1', phone: '5511982015967', message: 'Olá!' }, 'ALL', creator);
      expect(fsm.assign).not.toHaveBeenCalled();
    });

    it('envio automático (sem atendente) não atribui ninguém', async () => {
      const { svc, fsm } = make({ channelType: ChannelType.WHATSAPP_OFFICIAL, currentOwnerId: null });
      await svc.start('org1', { channelId: 'ch1', phone: '5511982015967', template: { name: 't' } }, 'ALL', undefined, {
        source: 'website_lead_followup',
      });
      expect(fsm.assign).not.toHaveBeenCalled();
    });

    it('falha na atribuição não impede o envio do template', async () => {
      const { svc, queue } = make({ currentOwnerId: null, assignError: new Error('conflito') });
      const res = await svc.start('org1', { channelId: 'ch1', phone: '5511982015967', message: 'Olá!' }, 'ALL', creator);
      expect(res.messageId).toBe('m1');
      expect(queue.add).toHaveBeenCalled();
    });
  });
});
