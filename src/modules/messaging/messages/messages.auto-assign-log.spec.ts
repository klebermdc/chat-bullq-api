import { ChannelType, OrgRole } from '@prisma/client';
import { MessagesService } from './messages.service';

/**
 * Quem responde uma conversa sem dono vira dono. Essa troca grava o log
 * ASSIGNED, senão o placar do dia não conta o cliente que o vendedor pegou.
 */
const SENT_AT = new Date('2026-11-08T13:00:00Z');

function makeService(assignedToId: string | null) {
  const conversation = {
    id: 'conv1',
    organizationId: 'org1',
    channelId: 'chan1',
    contactId: 'contact1',
    assignedToId,
    isGroup: false,
    aiEnabled: null,
    channel: { type: ChannelType.WHATSAPP_OFFICIAL },
    contact: { name: 'Cliente', channels: [{ channelId: 'chan1', externalId: '5511999' }] },
  };
  const prisma: any = {
    conversation: {
      findUnique: jest.fn().mockResolvedValue(conversation),
      update: jest.fn().mockResolvedValue({}),
    },
    organization: { findUnique: jest.fn().mockResolvedValue({ aiAutoDisableOnHuman: true }) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Bárbara' }) },
    conversationRead: { upsert: jest.fn().mockResolvedValue({}) },
    conversationAuditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const svc: MessagesService = Object.create(MessagesService.prototype);
  Object.assign(svc, {
    prisma,
    repository: { create: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'm1', createdAt: SENT_AT, ...data })) },
    outboundQueue: { add: jest.fn().mockResolvedValue({}) },
    conversationAccess: { assertConversationAccess: jest.fn().mockResolvedValue(undefined) },
    channelAccess: { assertChannelAccess: jest.fn() },
    watchdog: { cancelCheck: jest.fn().mockResolvedValue(undefined) },
    realtimeGateway: { emitToUser: jest.fn(), emitToChannel: jest.fn(), emitToConversation: jest.fn() },
    logger: { warn: jest.fn() },
  });
  return { svc, prisma, repository: (svc as any).repository };
}

const textDto = { conversationId: 'conv1', type: 'TEXT', content: { text: 'Oi!' } } as any;

describe('MessagesService.send — log ASSIGNED no auto-assign', () => {
  it('vendedor responde conversa sem dono: grava ASSIGNED para ele', async () => {
    const { svc, prisma } = makeService(null);
    await svc.send(textDto, 'seller-u2', 'org1', 'ALL', OrgRole.AGENT);
    expect(prisma.conversationAuditLog.create).toHaveBeenCalledWith({
      data: {
        conversationId: 'conv1',
        actorId: 'seller-u2',
        action: 'ASSIGNED',
        fromValue: null,
        toValue: 'seller-u2',
        createdAt: SENT_AT,
      },
    });
  });

  it('dono respondendo a própria conversa não grava log', async () => {
    const { svc, prisma } = makeService('seller-u2');
    await svc.send(textDto, 'seller-u2', 'org1', 'ALL', OrgRole.AGENT);
    expect(prisma.conversationAuditLog.create).not.toHaveBeenCalled();
  });

  it('falha ao gravar o log não derruba o envio', async () => {
    const { svc, prisma } = makeService(null);
    prisma.conversationAuditLog.create.mockRejectedValue(new Error('db fora'));
    await expect(svc.send(textDto, 'seller-u2', 'org1', 'ALL', OrgRole.AGENT)).resolves.toBeDefined();
  });

  it('envio automático em nome do vendedor fica marcado na mensagem', async () => {
    const { svc, repository } = makeService('seller-u2');
    await svc.send(textDto, 'seller-u2', 'org1', 'ALL', OrgRole.AGENT, { automated: true, system: true });
    expect(repository.create.mock.calls[0][0].metadata).toEqual({ automated: true });
  });

  it('envio humano sem citação não ganha metadata', async () => {
    const { svc, repository } = makeService('seller-u2');
    await svc.send(textDto, 'seller-u2', 'org1', 'ALL', OrgRole.AGENT);
    expect(repository.create.mock.calls[0][0].metadata).toBeUndefined();
  });
});
