import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { ContactHistoryService } from './contact-history.service';

describe('ContactHistoryService.resolveScope', () => {
  const current = {
    id: 'conv-atual',
    organizationId: 'org-1',
    channelId: 'ch-oficial',
    assignedToId: 'user-1',
    contact: { id: 'contact-1', phone: '5511982015967' },
  };

  const channelAccess = {
    hasAccess: (access: any, channelId: string) =>
      access === 'ALL' || access.has(channelId),
    assertChannelAccess: (access: any, channelId: string) => {
      if (access !== 'ALL' && !access.has(channelId)) {
        throw new ForbiddenException();
      }
    },
  };

  const buildPrisma = (contacts: any[], conversations: any[], conv: any = current) => ({
    conversation: {
      findUnique: jest.fn().mockResolvedValue(conv),
      findMany: jest.fn().mockResolvedValue(conversations),
    },
    contact: { findMany: jest.fn().mockResolvedValue(contacts) },
  });

  const build = (prisma: any) =>
    new ContactHistoryService(prisma as any, channelAccess as any);

  it('junta as conversas do mesmo telefone em outro contato/canal', async () => {
    const prisma = buildPrisma(
      [{ id: 'contact-1' }, { id: 'contact-antigo' }],
      [
        {
          id: 'conv-atual',
          protocol: 'P1',
          channelId: 'ch-oficial',
          createdAt: new Date('2026-08-06'),
          channel: { name: 'Comercial' },
        },
        {
          id: 'conv-velha',
          protocol: 'P0',
          channelId: 'ch-antigo',
          createdAt: new Date('2026-05-02'),
          channel: { name: 'Numero antigo' },
        },
      ],
    );

    const scope = await build(prisma).resolveScope(
      'conv-atual',
      'org-1',
      'ALL',
      'user-1',
      OrgRole.AGENT,
    );

    expect([...scope.conversationIds].sort()).toEqual(['conv-atual', 'conv-velha']);
    expect(scope.previousConversationIds).toEqual(['conv-velha']);
    expect(scope.conversations['conv-velha'].channelName).toBe('Numero antigo');
    expect(scope.hiddenByChannelAccess).toBe(0);
  });

  it('esconde conversa em canal sem acesso e conta quantas escondeu', async () => {
    const prisma = buildPrisma(
      [{ id: 'contact-1' }],
      [
        {
          id: 'conv-atual',
          protocol: 'P1',
          channelId: 'ch-oficial',
          createdAt: new Date('2026-08-06'),
          channel: { name: 'Comercial' },
        },
        {
          id: 'conv-velha',
          protocol: 'P0',
          channelId: 'ch-secreto',
          createdAt: new Date('2026-05-02'),
          channel: { name: 'Financeiro' },
        },
      ],
    );

    const scope = await build(prisma).resolveScope(
      'conv-atual',
      'org-1',
      new Set(['ch-oficial']),
      'user-1',
      OrgRole.AGENT,
    );

    expect(scope.previousConversationIds).toEqual([]);
    expect(scope.hiddenByChannelAccess).toBe(1);
    expect(scope.conversations['conv-velha']).toBeUndefined();
  });

  it('recusa quando o Operador não é o responsável pela conversa de entrada', async () => {
    const prisma = buildPrisma([{ id: 'contact-1' }], []);

    await expect(
      build(prisma).resolveScope('conv-atual', 'org-1', 'ALL', 'outro-user', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('não recusa conversa anterior atendida por outra pessoa', async () => {
    const prisma = buildPrisma(
      [{ id: 'contact-1' }],
      [
        {
          id: 'conv-atual',
          protocol: 'P1',
          channelId: 'ch-oficial',
          createdAt: new Date('2026-08-06'),
          channel: { name: 'Comercial' },
        },
        {
          id: 'conv-velha',
          protocol: 'P0',
          channelId: 'ch-oficial',
          createdAt: new Date('2026-05-02'),
          channel: { name: 'Comercial' },
        },
      ],
    );

    const scope = await build(prisma).resolveScope(
      'conv-atual',
      'org-1',
      'ALL',
      'user-1',
      OrgRole.AGENT,
    );

    expect(scope.previousConversationIds).toEqual(['conv-velha']);
  });

  it('recusa conversa de outra organização', async () => {
    const prisma = buildPrisma([], [], { ...current, organizationId: 'org-outra' });

    await expect(
      build(prisma).resolveScope('conv-atual', 'org-1', 'ALL', 'user-1', OrgRole.OWNER),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('estoura 404 quando a conversa não existe', async () => {
    const prisma = buildPrisma([], [], null);

    await expect(
      build(prisma).resolveScope('sumida', 'org-1', 'ALL', 'user-1', OrgRole.OWNER),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('sem telefone, fica só no próprio contato', async () => {
    const prisma = buildPrisma([], [], {
      ...current,
      contact: { id: 'contact-1', phone: null },
    });

    await build(prisma).resolveScope('conv-atual', 'org-1', 'ALL', 'user-1', OrgRole.AGENT);

    expect(prisma.contact.findMany).not.toHaveBeenCalled();
    expect(prisma.conversation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ contactId: { in: ['contact-1'] } }),
      }),
    );
  });
});

describe('ContactHistoryService.availability', () => {
  const channelAccess = {
    hasAccess: () => true,
    assertChannelAccess: () => undefined,
  };

  it('conta os atendimentos anteriores e o começo do histórico', async () => {
    const prisma = {
      conversation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'conv-atual',
          organizationId: 'org-1',
          channelId: 'ch-1',
          assignedToId: null,
          contact: { id: 'contact-1', phone: null },
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'conv-atual',
            protocol: 'P2',
            channelId: 'ch-1',
            createdAt: new Date('2026-08-06'),
            channel: { name: 'Comercial' },
          },
          {
            id: 'conv-b',
            protocol: 'P1',
            channelId: 'ch-1',
            createdAt: new Date('2026-06-01'),
            channel: { name: 'Comercial' },
          },
          {
            id: 'conv-a',
            protocol: 'P0',
            channelId: 'ch-1',
            createdAt: new Date('2026-02-14'),
            channel: { name: 'Comercial' },
          },
        ]),
      },
      contact: { findMany: jest.fn() },
    };

    const result = await new ContactHistoryService(
      prisma as any,
      channelAccess as any,
    ).availability('conv-atual', 'org-1', 'ALL', 'user-1', OrgRole.OWNER);

    expect(result.previousConversations).toBe(2);
    expect(result.oldestAt).toEqual(new Date('2026-02-14'));
  });

  it('devolve zero e sem data quando não há atendimento anterior', async () => {
    const prisma = {
      conversation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'conv-atual',
          organizationId: 'org-1',
          channelId: 'ch-1',
          assignedToId: null,
          contact: { id: 'contact-1', phone: null },
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'conv-atual',
            protocol: 'P2',
            channelId: 'ch-1',
            createdAt: new Date('2026-08-06'),
            channel: { name: 'Comercial' },
          },
        ]),
      },
      contact: { findMany: jest.fn() },
    };

    const result = await new ContactHistoryService(
      prisma as any,
      channelAccess as any,
    ).availability('conv-atual', 'org-1', 'ALL', 'user-1', OrgRole.OWNER);

    expect(result.previousConversations).toBe(0);
    expect(result.oldestAt).toBeNull();
  });
});
