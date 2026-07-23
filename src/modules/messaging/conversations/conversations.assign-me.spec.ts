import { ConversationsService } from './conversations.service';
import { ConversationAccessService } from './conversation-access.service';

/**
 * Cobre a saudação automática do atendente no caminho "assumir pra mim"
 * (POST /conversations/:id/assign-me). Esse era o 4º caminho de atribuição
 * humana que faltava — atribui via fsm.assign e precisa disparar o greet
 * quando o responsável EFETIVAMENTE muda (não em self-claim no-op).
 */
function makeService(assignedToId: string | null) {
  const conversation = {
    id: 'conv1',
    organizationId: 'org1',
    channelId: 'chan1',
    contactId: 'contact1',
    isGroup: false,
    assignedToId,
  };

  const repository = { findById: jest.fn().mockResolvedValue(conversation) };
  const fsm = { assign: jest.fn().mockResolvedValue(undefined) };
  const realtimeGateway = {
    emitToChannel: jest.fn(),
    emitToConversation: jest.fn(),
  };
  const prisma = {
    conversation: { findFirst: jest.fn().mockResolvedValue(conversation) },
  };
  const channelAccess = { assertChannelAccess: jest.fn() };
  const attendantGreeting = { greet: jest.fn().mockResolvedValue(undefined) };

  const svc: ConversationsService = Object.create(ConversationsService.prototype);
  Object.assign(svc, {
    repository,
    fsm,
    realtimeGateway,
    prisma,
    channelAccess,
    attendantGreeting,
    conversationAccess: new ConversationAccessService(prisma as any),
  });

  return { svc, fsm, attendantGreeting };
}

describe('ConversationsService.assignToMe — saudação', () => {
  it('dispara a saudação quando o responsável muda (assume conversa de outro/sem dono)', async () => {
    const { svc, fsm, attendantGreeting } = makeService('agent-original');

    await svc.assignToMe('conv1', 'org1', 'agent-new', 'ALL');

    expect(fsm.assign).toHaveBeenCalledWith('conv1', 'agent-new', 'agent-new');
    expect(attendantGreeting.greet).toHaveBeenCalledTimes(1);
    expect(attendantGreeting.greet).toHaveBeenCalledWith({
      conversationId: 'conv1',
      attendantUserId: 'agent-new',
      source: 'MANUAL_ASSIGN',
    });
  });

  it('NÃO dispara quando já é o responsável (self-claim no-op)', async () => {
    const { svc, attendantGreeting } = makeService('agent-x');

    await svc.assignToMe('conv1', 'org1', 'agent-x', 'ALL');

    expect(attendantGreeting.greet).not.toHaveBeenCalled();
  });
});
