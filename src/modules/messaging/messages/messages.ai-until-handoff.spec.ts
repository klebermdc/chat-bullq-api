import { ChannelType, OrgRole } from '@prisma/client';
import { MessagesService } from './messages.service';

/**
 * IA ligada pela automação do lead do site (`aiUntilHandoff`): ao contrário
 * do "forçar IA" manual, ela sai quando um humano responde no painel.
 */
function makeService(conversationOverrides: Record<string, any> = {}) {
  const conversation = {
    id: 'conv1',
    organizationId: 'org1',
    channelId: 'chan1',
    contactId: 'contact1',
    assignedToId: 'seller-u1',
    isGroup: false,
    aiEnabled: null,
    channel: { type: ChannelType.WHATSAPP_OFFICIAL },
    contact: { name: 'Cliente', channels: [{ channelId: 'chan1', externalId: '5511999' }] },
    ...conversationOverrides,
  };
  const prisma: any = {
    conversation: {
      findUnique: jest.fn().mockResolvedValue(conversation),
      update: jest.fn().mockResolvedValue({}),
    },
    organization: { findUnique: jest.fn().mockResolvedValue({ aiAutoDisableOnHuman: true }) },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Bárbara' }) },
    conversationRead: { upsert: jest.fn().mockResolvedValue({}) },
  };
  const repository = {
    create: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'm1', ...data })),
  };
  const outboundQueue = { add: jest.fn().mockResolvedValue({}) };
  const svc: MessagesService = Object.create(MessagesService.prototype);
  Object.assign(svc, {
    prisma,
    repository,
    outboundQueue,
    conversationAccess: { assertConversationAccess: jest.fn().mockResolvedValue(undefined) },
    channelAccess: { assertChannelAccess: jest.fn() },
    watchdog: { cancelCheck: jest.fn().mockResolvedValue(undefined) },
    realtimeGateway: {
      emitToUser: jest.fn(),
      emitToChannel: jest.fn(),
      emitToConversation: jest.fn(),
    },
    logger: { warn: jest.fn() },
  });
  const sentText = () => outboundQueue.add.mock.calls[0][1].message.content.text;
  return { svc, repository, outboundQueue, sentText, prisma };
}

const textDto = (extra: Record<string, any> = {}) =>
  ({ conversationId: 'conv1', type: 'TEXT', content: { text: 'Oi, tudo bem?' }, ...extra }) as any;

describe('MessagesService.send — humano responde em conversa com a Aline até o handoff', () => {
  const aiFields = (prisma: any) => prisma.conversation.update.mock.calls[0][0].data;

  it('aiUntilHandoff: desliga a IA e limpa a flag, mesmo com aiEnabled=true', async () => {
    const { svc, prisma } = makeService({ aiEnabled: true, aiUntilHandoff: true, activeAgentId: 'aline' });
    await svc.send(textDto(), 'seller-u1', 'org1', 'ALL', OrgRole.AGENT);
    expect(aiFields(prisma)).toMatchObject({ aiEnabled: false, activeAgentId: null, aiUntilHandoff: false });
  });

  it('aiEnabled=true ligado por humano (sem a flag) continua ligado', async () => {
    const { svc, prisma } = makeService({ aiEnabled: true, aiUntilHandoff: false });
    await svc.send(textDto(), 'seller-u1', 'org1', 'ALL', OrgRole.AGENT);
    expect(aiFields(prisma).aiEnabled).toBeUndefined();
  });
});
