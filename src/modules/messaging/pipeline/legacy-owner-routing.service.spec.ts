import { LegacyOwnerRoutingService } from './legacy-owner-routing.service';

const PARAMS = {
  organizationId: 'org-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
};

const LEGACY_ROW = {
  vendedor: 'Renata',
  etapa: 'Lead',
  tags: 'vip',
  user_id: 'user-renata',
};

function make(
  overrides: {
    phone?: string | null;
    rows?: unknown[];
    member?: unknown;
  } = {},
) {
  const updated = { id: 'conv-1', channelId: 'ch-1', assignedToId: 'user-renata' };
  const prisma = {
    contact: {
      findUnique: jest.fn().mockResolvedValue({
        phone: overrides.phone === undefined ? '558599998888' : overrides.phone,
      }),
    },
    $queryRaw: jest.fn().mockResolvedValue(overrides.rows ?? [LEGACY_ROW]),
    userOrganization: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          overrides.member === undefined ? { id: 'uo-1' } : overrides.member,
        ),
    },
    conversation: {
      update: jest.fn().mockResolvedValue(updated),
    },
  } as any;
  const fsm = { assign: jest.fn().mockResolvedValue(undefined) } as any;
  const realtime = {
    emitToChannel: jest.fn(),
    emitToConversation: jest.fn(),
  } as any;

  return {
    service: new LegacyOwnerRoutingService(prisma, fsm, realtime),
    prisma,
    fsm,
    realtime,
    updated,
  };
}

describe('LegacyOwnerRoutingService.routeNewConversation', () => {
  it('atribui ao vendedor legado, desliga a IA e avisa o front', async () => {
    const { service, fsm, prisma, realtime, updated } = make();

    const result = await service.routeNewConversation(PARAMS);

    expect(result).toEqual({ routed: true, userId: 'user-renata', vendedor: 'Renata' });
    expect(fsm.assign).toHaveBeenCalledWith('conv-1', 'user-renata');
    expect(prisma.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { aiEnabled: false, activeAgentId: null },
    });
    expect(realtime.emitToChannel).toHaveBeenCalledWith('ch-1', 'conversation:updated', {
      conversation: updated,
    });
    expect(realtime.emitToConversation).toHaveBeenCalledWith(
      'conv-1',
      'conversation:updated',
      { conversation: updated },
    );
  });

  it('só aceita vendedor ativo e membro da organização da conversa', async () => {
    const { service, prisma } = make();

    await service.routeNewConversation(PARAMS);

    expect(prisma.userOrganization.findFirst).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        userId: 'user-renata',
        user: { isActive: true, deletedAt: null },
      },
      select: { id: true },
    });
  });

  it('não roteia contato sem telefone (Instagram, Messenger)', async () => {
    const { service, prisma, fsm } = make({ phone: null });

    const result = await service.routeNewConversation(PARAMS);

    expect(result).toEqual({ routed: false, reason: 'no_phone' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(fsm.assign).not.toHaveBeenCalled();
  });

  it('segue a distribuição normal quando o telefone não está na carteira', async () => {
    const { service, fsm } = make({ rows: [] });

    const result = await service.routeNewConversation(PARAMS);

    expect(result).toEqual({ routed: false, reason: 'not_found' });
    expect(fsm.assign).not.toHaveBeenCalled();
  });

  it('segue a distribuição normal quando o vendedor não tem usuário mapeado', async () => {
    const { service, fsm } = make({ rows: [{ ...LEGACY_ROW, user_id: null }] });

    const result = await service.routeNewConversation(PARAMS);

    expect(result).toEqual({ routed: false, reason: 'unmapped', vendedor: 'Renata' });
    expect(fsm.assign).not.toHaveBeenCalled();
  });

  it('segue a distribuição normal quando o vendedor está inativo ou fora da org', async () => {
    const { service, fsm, prisma } = make({ member: null });

    const result = await service.routeNewConversation(PARAMS);

    expect(result).toEqual({ routed: false, reason: 'inactive', vendedor: 'Renata' });
    expect(fsm.assign).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('não desliga a IA se a atribuição falhar (ex.: corrida com outro atendente)', async () => {
    const { service, fsm, prisma } = make();
    fsm.assign.mockRejectedValue(new Error('Conversation was assigned concurrently'));

    await expect(service.routeNewConversation(PARAMS)).rejects.toThrow('concurrently');
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });
});
