import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { MessagesService } from './messages.service';

const conversation = {
  id: 'conv1',
  organizationId: 'org1',
  channelId: 'chan1',
  assignedToId: 'colega-u2',
  contactId: 'contact1',
  channel: { id: 'chan1', type: 'WHATSAPP_OFFICIAL' },
  contact: {
    channels: [
      { channelId: 'chan1', externalId: '5511999999999@s.whatsapp.net' },
    ],
  },
};

function makeService(target: unknown) {
  const prisma: any = {
    message: { findFirst: jest.fn().mockResolvedValue(target) },
    conversation: { update: jest.fn() },
    conversationRead: { upsert: jest.fn() },
  };
  const repository = {
    create: jest
      .fn()
      .mockImplementation((data: any) =>
        Promise.resolve({ id: 'msg-nova', ...data }),
      ),
  };
  const outboundQueue = { add: jest.fn().mockResolvedValue(undefined) };
  const realtimeGateway = {
    emitToConversation: jest.fn(),
    emitToUser: jest.fn(),
    emitToChannel: jest.fn(),
  };
  const conversationAccess = { assertConversationAccess: jest.fn() };
  const channelAccess = { assertChannelAccess: jest.fn() };
  const watchdog = { cancelCheck: jest.fn().mockResolvedValue(undefined) };

  const svc: MessagesService = Object.create(MessagesService.prototype);
  Object.assign(svc, {
    prisma,
    repository,
    outboundQueue,
    realtimeGateway,
    conversationAccess,
    channelAccess,
    watchdog,
  });
  return { svc, prisma, repository, outboundQueue, watchdog };
}

describe('MessagesService.react', () => {
  it('grava targetMessageId com o id EXTERNO da mensagem alvo', async () => {
    const { svc, repository, outboundQueue } = makeService({
      id: 'msg-alvo',
      externalId: 'wamid.ABC',
      conversation,
    });

    await svc.react('msg-alvo', '👍', 'user-1', 'org1', 'ALL', OrgRole.AGENT);

    // 'wamid.ABC' e não 'msg-alvo': é o id externo que o mapper da Cloud API lê.
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'REACTION',
        content: { reaction: { emoji: '👍', targetMessageId: 'wamid.ABC' } },
      }),
    );
    expect(outboundQueue.add).toHaveBeenCalledWith(
      'send-outbound',
      expect.objectContaining({
        message: {
          type: 'REACTION',
          content: { reaction: { emoji: '👍', targetMessageId: 'wamid.ABC' } },
        },
      }),
      expect.anything(),
    );
  });

  it('recusa emoji que não é um único grafema', async () => {
    const { svc } = makeService({
      id: 'msg-alvo',
      externalId: 'wamid.ABC',
      conversation,
    });

    await expect(
      svc.react('msg-alvo', 'oi', 'user-1', 'org1', 'ALL', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      svc.react('msg-alvo', '👍👎', 'user-1', 'org1', 'ALL', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('NÃO reatribui a conversa, NÃO desliga a IA e NÃO cancela o watchdog', async () => {
    // Este teste é o motivo de react() existir separado de send(). Se alguém
    // "simplificar" react() para chamar send(), ele quebra — que é o objetivo.
    const { svc, prisma, watchdog } = makeService({
      id: 'msg-alvo',
      externalId: 'wamid.ABC',
      conversation,
    });

    await svc.react('msg-alvo', '👍', 'user-1', 'org1', 'ALL', OrgRole.AGENT);

    expect(prisma.conversation.update).not.toHaveBeenCalled();
    expect(prisma.conversationRead.upsert).not.toHaveBeenCalled();
    expect(watchdog.cancelCheck).not.toHaveBeenCalled();
  });

  it('recusa reagir a mensagem ainda não sincronizada com o provider', async () => {
    const { svc } = makeService({
      id: 'msg-alvo',
      externalId: null,
      conversation,
    });

    await expect(
      svc.react('msg-alvo', '👍', 'user-1', 'org1', 'ALL', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('recusa mensagem inexistente', async () => {
    const { svc } = makeService(null);

    await expect(
      svc.react('nao-existe', '👍', 'user-1', 'org1', 'ALL', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('recusa mensagem de outra organização', async () => {
    const { svc } = makeService({
      id: 'msg-alvo',
      externalId: 'wamid.ABC',
      conversation: { ...conversation, organizationId: 'org-OUTRA' },
    });

    await expect(
      svc.react('msg-alvo', '👍', 'user-1', 'org1', 'ALL', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
