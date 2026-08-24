import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MessageContentType } from '@prisma/client';
import { ConversationsService } from './conversations.service';

/**
 * Cobre o fluxo de transferência intencional de cliente:
 *  - reusa o FSM.assign (audit log + automação)
 *  - grava mensagem SYSTEM no thread (sem enviar ao WhatsApp)
 *  - valida destino e evita no-op (mesmo dono)
 */
function makeService(opts: {
  conversation?: Record<string, any>;
  targetMember?: Record<string, any> | null;
  fromUser?: Record<string, any> | null;
}) {
  const conversation = opts.conversation ?? {
    id: 'conv1',
    organizationId: 'org1',
    channelId: 'chan1',
    contactId: 'contact1',
    isGroup: false,
    assignedToId: 'agent-original',
  };

  const repository = {
    findById: jest.fn().mockResolvedValue(conversation),
  };
  const fsm = { assign: jest.fn().mockResolvedValue(undefined) };
  const realtimeGateway = {
    emitToChannel: jest.fn(),
    emitToConversation: jest.fn(),
  };
  const createdSystemMessage = { id: 'sysmsg1', type: MessageContentType.SYSTEM };
  const prisma = {
    userOrganization: {
      findFirst: jest.fn().mockResolvedValue(
        opts.targetMember === undefined
          ? { user: { id: 'agent-new', name: 'Maria' } }
          : opts.targetMember,
      ),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(
        opts.fromUser === undefined ? { name: 'João' } : opts.fromUser,
      ),
    },
    message: { create: jest.fn().mockResolvedValue(createdSystemMessage) },
  };
  const channelAccess = { assertChannelAccess: jest.fn() };

  const svc: ConversationsService = Object.create(ConversationsService.prototype);
  Object.assign(svc, {
    repository,
    fsm,
    realtimeGateway,
    prisma,
    channelAccess,
  });

  return { svc, repository, fsm, realtimeGateway, prisma, createdSystemMessage, conversation };
}

describe('ConversationsService.transfer', () => {
  it('reatribui via FSM e grava mensagem SYSTEM com nomes de origem/destino', async () => {
    const { svc, fsm, prisma } = makeService({});

    await svc.transfer('conv1', 'org1', 'agent-new', 'actor-adm', undefined, 'ALL');

    expect(fsm.assign).toHaveBeenCalledWith('conv1', 'agent-new', 'actor-adm');
    expect(prisma.message.create).toHaveBeenCalledTimes(1);
    const data = prisma.message.create.mock.calls[0][0].data;
    expect(data.type).toBe(MessageContentType.SYSTEM);
    expect(data.senderId).toBe('actor-adm');
    expect(data.content.text).toContain('João');
    expect(data.content.text).toContain('Maria');
    expect(data.content.transfer).toEqual({
      fromId: 'agent-original',
      toId: 'agent-new',
      reason: null,
    });
  });

  it('inclui o motivo no texto e na metadata quando informado', async () => {
    const { svc, prisma } = makeService({});

    await svc.transfer('conv1', 'org1', 'agent-new', 'actor-adm', '  cliente VIP  ', 'ALL');

    const data = prisma.message.create.mock.calls[0][0].data;
    expect(data.content.text).toContain('Motivo: cliente VIP');
    expect(data.content.transfer.reason).toBe('cliente VIP');
  });

  it('emite message:new no realtime pra aparecer no thread na hora', async () => {
    const { svc, realtimeGateway, createdSystemMessage } = makeService({});

    await svc.transfer('conv1', 'org1', 'agent-new', 'actor-adm', undefined, 'ALL');

    expect(realtimeGateway.emitToChannel).toHaveBeenCalledWith(
      'chan1',
      'message:new',
      expect.objectContaining({ message: createdSystemMessage }),
    );
    expect(realtimeGateway.emitToConversation).toHaveBeenCalledWith(
      'conv1',
      'message:new',
      expect.objectContaining({ message: createdSystemMessage }),
    );
  });

  it('rejeita transferência pra quem já é o dono (no-op evitado)', async () => {
    const { svc, fsm } = makeService({
      conversation: {
        id: 'conv1',
        organizationId: 'org1',
        channelId: 'chan1',
        contactId: 'contact1',
        isGroup: false,
        assignedToId: 'agent-new',
      },
    });

    await expect(
      svc.transfer('conv1', 'org1', 'agent-new', 'actor-adm', undefined, 'ALL'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fsm.assign).not.toHaveBeenCalled();
  });

  it('rejeita destino que não é membro ativo da org', async () => {
    const { svc, fsm, prisma } = makeService({ targetMember: null });

    await expect(
      svc.transfer('conv1', 'org1', 'ghost', 'actor-adm', undefined, 'ALL'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(fsm.assign).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('conversa órfã (sem dono anterior) → texto usa "ninguém" como origem', async () => {
    const { svc, prisma } = makeService({
      conversation: {
        id: 'conv1',
        organizationId: 'org1',
        channelId: 'chan1',
        contactId: 'contact1',
        isGroup: false,
        assignedToId: null,
      },
      fromUser: null,
    });

    await svc.transfer('conv1', 'org1', 'agent-new', 'actor-adm', undefined, 'ALL');

    const data = prisma.message.create.mock.calls[0][0].data;
    expect(data.content.text).toContain('ninguém');
    expect(data.content.transfer.fromId).toBeNull();
  });
});
