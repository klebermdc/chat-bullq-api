import { NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { MessagesService } from './messages.service';
import { ConversationsService } from '../conversations/conversations.service';

/**
 * Cobre a mesma classe de bug de conversations.access.spec.ts, agora no
 * caminho de mensagens: `send` e `revokeForEveryone` reusam a guarda
 * compartilhada `ConversationsService.assertConversationAccess` — usa a
 * instância REAL do serviço (com prisma mockado), não um double, pra provar
 * a integração de verdade e não só "o mock foi chamado".
 */
function makeConversationsService(conversationFound: unknown) {
  const prisma: any = {
    conversation: { findFirst: jest.fn().mockResolvedValue(conversationFound) },
  };
  const svc: ConversationsService = Object.create(ConversationsService.prototype);
  Object.assign(svc, { prisma });
  return { conversations: svc, guardPrisma: prisma };
}

function makeMessagesService(opts: {
  conversation: Record<string, any>;
  conversationsGuardFinds: unknown;
}) {
  const prisma: any = {
    conversation: { findUnique: jest.fn().mockResolvedValue(opts.conversation) },
  };
  const { conversations, guardPrisma } = makeConversationsService(
    opts.conversationsGuardFinds,
  );
  const channelAccess = { assertChannelAccess: jest.fn() };
  const svc: MessagesService = Object.create(MessagesService.prototype);
  Object.assign(svc, { prisma, conversations, channelAccess });
  return { svc, prisma, channelAccess, guardPrisma };
}

describe('MessagesService.send — AGENT não manda mensagem em conversa alheia', () => {
  const baseConversation = {
    id: 'conv1',
    organizationId: 'org1',
    channelId: 'chan1',
    assignedToId: 'colega-u2',
    contact: { channels: [] },
  };

  it('AGENT + conversa de colega → NotFound, sem chegar no channelAccess', async () => {
    const { svc, channelAccess } = makeMessagesService({
      conversation: baseConversation,
      conversationsGuardFinds: null, // findFirst escopado do guard não acha nada
    });

    await expect(
      svc.send(
        { conversationId: 'conv1', type: 'TEXT', content: { text: 'oi' } } as any,
        'agent-u1',
        'org1',
        'ALL',
        OrgRole.AGENT,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(channelAccess.assertChannelAccess).not.toHaveBeenCalled();
  });

  it('AGENT + conversa própria → passa da guarda (chega no channelAccess)', async () => {
    const { svc, channelAccess } = makeMessagesService({
      conversation: { ...baseConversation, assignedToId: 'agent-u1' },
      conversationsGuardFinds: { id: 'conv1', assignedToId: 'agent-u1' },
    });
    // Sentinela: prova que o fluxo passou da guarda de escopo e chegou no
    // check de canal, sem precisar mockar o resto do pipeline de envio.
    channelAccess.assertChannelAccess.mockImplementation(() => {
      throw new Error('reached-channel-check');
    });

    await expect(
      svc.send(
        { conversationId: 'conv1', type: 'TEXT', content: { text: 'oi' } } as any,
        'agent-u1',
        'org1',
        'ALL',
        OrgRole.AGENT,
      ),
    ).rejects.toThrow('reached-channel-check');
  });

  it('chamador de sistema (role indefinida) NÃO é barrado mesmo em conversa de outro dono', async () => {
    const { svc, channelAccess } = makeMessagesService({
      conversation: baseConversation,
      // Se a guarda rodasse, bloquearia (findFirst escopado devolve null) —
      // ela não deve nem ser chamada quando `role` está ausente.
      conversationsGuardFinds: null,
    });
    channelAccess.assertChannelAccess.mockImplementation(() => {
      throw new Error('reached-channel-check');
    });

    await expect(
      svc.send(
        { conversationId: 'conv1', type: 'TEXT', content: { text: 'oi' } } as any,
        'system-bot',
        'org1',
        'ALL',
        undefined,
      ),
    ).rejects.toThrow('reached-channel-check');
  });
});

describe('MessagesService.revokeForEveryone — AGENT não revoga mensagem de conversa alheia', () => {
  function messageFixture(overrides: Record<string, any> = {}) {
    return {
      id: 'msg1',
      direction: 'OUTBOUND',
      externalId: 'ext1',
      revokedAt: null,
      conversation: { id: 'conv1', organizationId: 'org1', channelId: 'chan1' },
      ...overrides,
    };
  }

  function makeRevokeService(opts: {
    message: Record<string, any>;
    conversationsGuardFinds: unknown;
  }) {
    const prisma: any = {
      message: { findUnique: jest.fn().mockResolvedValue(opts.message) },
    };
    const { conversations } = makeConversationsService(opts.conversationsGuardFinds);
    const channelAccess = { assertChannelAccess: jest.fn() };
    const svc: MessagesService = Object.create(MessagesService.prototype);
    Object.assign(svc, { prisma, conversations, channelAccess });
    return { svc, channelAccess };
  }

  it('AGENT + conversa de colega → NotFound antes de checar canal/provider', async () => {
    const { svc, channelAccess } = makeRevokeService({
      message: messageFixture(),
      conversationsGuardFinds: null,
    });

    await expect(
      svc.revokeForEveryone('msg1', 'org1', 'agent-u1', 'ALL', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(channelAccess.assertChannelAccess).not.toHaveBeenCalled();
  });

  it('AGENT + conversa própria → passa da guarda (chega no channelAccess)', async () => {
    const { svc, channelAccess } = makeRevokeService({
      message: messageFixture(),
      conversationsGuardFinds: { id: 'conv1' },
    });
    channelAccess.assertChannelAccess.mockImplementation(() => {
      throw new Error('reached-channel-check');
    });

    await expect(
      svc.revokeForEveryone('msg1', 'org1', 'agent-u1', 'ALL', OrgRole.AGENT),
    ).rejects.toThrow('reached-channel-check');
  });
});
