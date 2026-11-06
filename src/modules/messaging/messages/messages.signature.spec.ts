import { ForbiddenException } from '@nestjs/common';
import { ChannelType, OrgRole } from '@prisma/client';
import { MessagesService } from './messages.service';

/**
 * Assinatura do vendedor no caminho real de `send`: o texto que vai pra fila
 * do provedor leva "*Nome:*" na linha de cima; o que é gravado no banco não.
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
  return { svc, repository, outboundQueue, sentText };
}

const textDto = (extra: Record<string, any> = {}) =>
  ({ conversationId: 'conv1', type: 'TEXT', content: { text: 'Oi, tudo bem?' }, ...extra }) as any;

describe('MessagesService.send — assinatura do vendedor', () => {
  it('vendedor: cliente recebe a assinatura, banco guarda o texto limpo', async () => {
    const { svc, repository, sentText } = makeService();

    await svc.send(textDto(), 'seller-u1', 'org1', 'ALL', OrgRole.AGENT);

    expect(sentText()).toBe('*Bárbara:*\nOi, tudo bem?');
    expect(repository.create.mock.calls[0][0].content).toEqual({ text: 'Oi, tudo bem?' });
  });

  it('Instagram: assinatura sem asteriscos', async () => {
    const { svc, sentText } = makeService({ channel: { type: ChannelType.INSTAGRAM } });

    await svc.send(textDto(), 'seller-u1', 'org1', 'ALL', OrgRole.AGENT);

    expect(sentText()).toBe('Bárbara:\nOi, tudo bem?');
  });

  it('vendedor pedindo sem assinatura → 403 e nada é gravado nem enviado', async () => {
    const { svc, repository, outboundQueue } = makeService();

    await expect(
      svc.send(textDto({ unsigned: true }), 'seller-u1', 'org1', 'ALL', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.create).not.toHaveBeenCalled();
    expect(outboundQueue.add).not.toHaveBeenCalled();
  });

  it.each([OrgRole.ADMIN, OrgRole.OWNER])('%s pode enviar sem assinatura', async (role) => {
    const { svc, sentText } = makeService();

    await svc.send(textDto({ unsigned: true }), 'seller-u1', 'org1', 'ALL', role);

    expect(sentText()).toBe('Oi, tudo bem?');
  });

  it('ADM sem pedir nada também assina', async () => {
    const { svc, sentText } = makeService();

    await svc.send(textDto(), 'seller-u1', 'org1', 'ALL', OrgRole.ADMIN);

    expect(sentText()).toBe('*Bárbara:*\nOi, tudo bem?');
  });

  it('mensagem automática e de sistema saem sem assinatura', async () => {
    const auto = makeService();
    await auto.svc.send(textDto(), 'seller-u1', 'org1', 'ALL', undefined, {
      automated: true,
      system: true,
    });
    expect(auto.sentText()).toBe('Oi, tudo bem?');

    const system = makeService();
    await system.svc.send(textDto(), 'seller-u1', 'org1', 'ALL', undefined, { system: true });
    expect(system.sentText()).toBe('Oi, tudo bem?');
  });

  it('grupo continua assinando mesmo em envio de sistema', async () => {
    const { svc, sentText } = makeService({ isGroup: true });

    await svc.send(textDto(), 'seller-u1', 'org1', 'ALL', undefined, { system: true });

    expect(sentText()).toBe('*Bárbara:*\nOi, tudo bem?');
  });

  it('imagem não leva assinatura', async () => {
    const { svc, outboundQueue } = makeService();
    const content = { mediaUrl: 'https://x/y.jpg', caption: 'foto' };

    await svc.send(
      { conversationId: 'conv1', type: 'IMAGE', content } as any,
      'seller-u1',
      'org1',
      'ALL',
      OrgRole.AGENT,
    );

    expect(outboundQueue.add.mock.calls[0][1].message.content).toEqual(content);
  });
});
