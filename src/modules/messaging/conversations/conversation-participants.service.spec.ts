import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import { ConversationParticipantsService } from './conversation-participants.service';

const CONV = { id: 'c1', channelId: 'ch1', contactId: 'k1', assignedToId: 'renata' };

function makeService(opts: {
  conversation?: unknown;
  member?: unknown;
  channels?: 'ALL' | Set<string>;
  createError?: unknown;
  deleted?: number;
} = {}) {
  const prisma: any = {
    conversationParticipant: {
      create: opts.createError
        ? jest.fn().mockRejectedValue(opts.createError)
        : jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: opts.deleted ?? 1 }),
    },
    userOrganization: {
      findFirst: jest.fn().mockResolvedValue(
        opts.member === undefined
          ? { id: 'uo-k', role: OrgRole.AGENT, user: { name: 'Kleber' } }
          : opts.member,
      ),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Renata' }) },
    message: { create: jest.fn().mockResolvedValue({ id: 'm1' }) },
    contact: {
      findUnique: jest.fn().mockResolvedValue({ name: 'Cliente X', phone: '5511' }),
    },
    tag: {
      findFirst: jest.fn().mockResolvedValue({ id: 'tag-k', color: '#123456' }),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    conversationTag: {
      upsert: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const access: any = {
    assertConversationAccess: jest.fn().mockResolvedValue(opts.conversation ?? CONV),
  };
  const channelAccess: any = {
    assertChannelAccess: jest.fn(),
    isBypassRole: (r: OrgRole) => r === OrgRole.ADMIN || r === OrgRole.OWNER,
    getAccessibleChannelIds: jest
      .fn()
      .mockResolvedValue(opts.channels ?? new Set(['ch1'])),
  };
  const conversations: any = { broadcastById: jest.fn() };
  const realtime: any = { emitToChannel: jest.fn(), emitToConversation: jest.fn() };
  const notifications: any = { notify: jest.fn().mockResolvedValue({}) };
  const svc = new ConversationParticipantsService(
    prisma,
    access,
    channelAccess,
    conversations,
    realtime,
    notifications,
  );
  return { svc, prisma, conversations, realtime, notifications };
}

const renata = { userId: 'renata', role: OrgRole.AGENT, access: 'ALL' as const };

describe('ConversationParticipantsService.add', () => {
  it('Renata inclui o Kleber: grava, registra no chat e avisa as telas', async () => {
    const { svc, prisma, conversations } = makeService();
    await svc.add('c1', 'org1', 'kleber', renata);
    expect(prisma.conversationParticipant.create).toHaveBeenCalledWith({
      data: { conversationId: 'c1', userId: 'kleber', addedById: 'renata' },
    });
    expect(prisma.message.create.mock.calls[0][0].data.content.text).toBe(
      '👥 Renata incluiu Kleber na conversa',
    );
    expect(prisma.message.create.mock.calls[0][0].data.type).toBe('SYSTEM');
    expect(conversations.broadcastById).toHaveBeenCalledWith('c1');
  });

  it('põe a etiqueta do incluído só na conversa (não na ficha) e avisa ele', async () => {
    const { svc, prisma, notifications } = makeService();
    await svc.add('c1', 'org1', 'kleber', renata);
    expect(prisma.conversationTag.upsert).toHaveBeenCalledWith({
      where: { conversationId_tagId: { conversationId: 'c1', tagId: 'tag-k' } },
      create: { conversationId: 'c1', tagId: 'tag-k' },
      update: {},
    });
    expect(prisma.contactTag).toBeUndefined();
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'kleber',
        organizationId: 'org1',
        title: 'Você foi incluído numa conversa',
        body: 'Renata incluiu você na conversa com Cliente X.',
        data: { conversationId: 'c1', kind: 'participant_added' },
      }),
    );
  });

  it('falha no aviso não desfaz a inclusão', async () => {
    const { svc, notifications } = makeService();
    notifications.notify.mockRejectedValue(new Error('fila fora'));
    await expect(svc.add('c1', 'org1', 'kleber', renata)).resolves.toBeDefined();
  });

  it('não inclui o próprio dono', async () => {
    const { svc } = makeService();
    await expect(svc.add('c1', 'org1', 'renata', renata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('vendedor fora da organização → NotFound', async () => {
    const { svc } = makeService({ member: null });
    await expect(svc.add('c1', 'org1', 'x', renata)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('vendedor sem acesso ao canal da conversa → BadRequest', async () => {
    const { svc } = makeService({ channels: new Set(['outro']) });
    await expect(svc.add('c1', 'org1', 'kleber', renata)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('incluir duas vezes → mensagem amigável', async () => {
    const dup = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'x',
    });
    const { svc } = makeService({ createError: dup });
    await expect(svc.add('c1', 'org1', 'kleber', renata)).rejects.toThrow(
      'Este vendedor já está na conversa.',
    );
  });
});

describe('ConversationParticipantsService.remove', () => {
  it('o incluído pode sair', async () => {
    const { svc, prisma } = makeService();
    const kleber = { userId: 'kleber', role: OrgRole.AGENT, access: 'ALL' as const };
    await svc.remove('c1', 'org1', 'kleber', kleber);
    expect(prisma.conversationParticipant.deleteMany).toHaveBeenCalledWith({
      where: { conversationId: 'c1', userId: 'kleber' },
    });
  });

  it('ao sair, a etiqueta dele some da conversa', async () => {
    const { svc, prisma } = makeService();
    prisma.user.findUnique.mockResolvedValue({ name: 'Kleber' });
    const kleber = { userId: 'kleber', role: OrgRole.AGENT, access: 'ALL' as const };
    await svc.remove('c1', 'org1', 'kleber', kleber);
    expect(prisma.conversationTag.deleteMany).toHaveBeenCalledWith({
      where: {
        conversationId: 'c1',
        tag: { organizationId: 'org1', name: { equals: 'Kleber', mode: 'insensitive' } },
      },
    });
  });

  it('o dono pode tirar o incluído', async () => {
    const { svc } = makeService();
    await expect(svc.remove('c1', 'org1', 'kleber', renata)).resolves.toEqual({
      removed: true,
    });
  });

  it('um incluído não tira outro incluído', async () => {
    const { svc } = makeService();
    const pedro = { userId: 'pedro', role: OrgRole.AGENT, access: 'ALL' as const };
    await expect(svc.remove('c1', 'org1', 'kleber', pedro)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('ADM tira qualquer um', async () => {
    const { svc } = makeService();
    const adm = { userId: 'adm', role: OrgRole.ADMIN, access: 'ALL' as const };
    await expect(svc.remove('c1', 'org1', 'kleber', adm)).resolves.toEqual({
      removed: true,
    });
  });

  it('quem não está na conversa → NotFound', async () => {
    const { svc } = makeService({ deleted: 0 });
    await expect(svc.remove('c1', 'org1', 'kleber', renata)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
