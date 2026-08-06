import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { MessagesService } from './messages.service';

/**
 * As três leituras novas de histórico (rolar pra cima, janela do "pular até" e
 * busca por conteúdo) compartilham a MESMA guarda de `findByConversation`.
 * Guarda compartilhada tem um risco próprio: um caminho novo que esqueça de
 * chamá-la vaza histórico inteiro de outra organização. Estes testes prendem
 * as quatro entradas no mesmo contrato.
 */
function makeService(conversation: Record<string, unknown> | null) {
  const prisma: any = {
    conversation: { findUnique: jest.fn().mockResolvedValue(conversation) },
  };
  const channelAccess = {
    assertChannelAccess: jest.fn((access: unknown, channelId: string) => {
      if (access !== 'ALL' && !(access as Set<string>).has(channelId)) {
        throw new ForbiddenException();
      }
    }),
  };
  const segmentRead = { groupSiblingIds: jest.fn().mockResolvedValue(null) };
  const repository = {
    findByConversation: jest.fn().mockResolvedValue({ messages: [], total: 0 }),
    findOlderThan: jest.fn().mockResolvedValue({ messages: [], hasMore: false }),
    findWindowAround: jest
      .fn()
      .mockResolvedValue({ messages: [], hasOlder: false, isAtEnd: true }),
    searchInConversations: jest.fn().mockResolvedValue([]),
  };

  const svc: MessagesService = Object.create(MessagesService.prototype);
  Object.assign(svc, { prisma, channelAccess, segmentRead, repository });
  return { svc, repository, segmentRead };
}

const CONVERSATION = {
  id: 'conv1',
  organizationId: 'org1',
  channelId: 'chan1',
  assignedToId: 'colega-u2',
};

/** Cada entrada de leitura, com os argumentos que só variam no meio. */
const READS = [
  {
    name: 'findByConversation',
    call: (svc: MessagesService, org: string, access: any, user?: string, role?: OrgRole) =>
      svc.findByConversation('conv1', org, 1, 50, access, user, role),
  },
  {
    name: 'findOlderThan',
    call: (svc: MessagesService, org: string, access: any, user?: string, role?: OrgRole) =>
      svc.findOlderThan('conv1', org, 'msg-9', 50, access, user, role),
  },
  {
    name: 'findWindowAround',
    call: (svc: MessagesService, org: string, access: any, user?: string, role?: OrgRole) =>
      svc.findWindowAround('conv1', org, 'msg-9', 25, access, user, role),
  },
  {
    name: 'searchInConversation',
    call: (svc: MessagesService, org: string, access: any, user?: string, role?: OrgRole) =>
      svc.searchInConversation('conv1', org, 'disney', 50, access, user, role),
  },
];

describe.each(READS)('MessagesService.$name — guarda de histórico', ({ call }) => {
  it('conversa de outra organização → Forbidden', async () => {
    const { svc } = makeService(CONVERSATION);

    await expect(call(svc, 'org-INTRUSA', 'ALL')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('conversa inexistente → NotFound', async () => {
    const { svc } = makeService(null);

    await expect(call(svc, 'org1', 'ALL')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('canal fora do teto de acesso → Forbidden', async () => {
    const { svc } = makeService(CONVERSATION);

    await expect(
      call(svc, 'org1', new Set(['outro-canal'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('AGENT escopado por atribuição não lê conversa de colega → Forbidden', async () => {
    const { svc } = makeService(CONVERSATION);

    await expect(
      call(svc, 'org1', 'ALL', 'agent-u1', OrgRole.AGENT),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('atendente atribuído lê normalmente', async () => {
    const { svc } = makeService(CONVERSATION);

    await expect(
      call(svc, 'org1', 'ALL', 'colega-u2', OrgRole.AGENT),
    ).resolves.toBeDefined();
  });
});

describe('MessagesService — escopo de segmento nas leituras de histórico', () => {
  it('grupo de segmento busca nas conversas-irmãs, não só na aberta', async () => {
    const { svc, repository, segmentRead } = makeService(CONVERSATION);
    segmentRead.groupSiblingIds.mockResolvedValue(['conv1', 'conv2']);

    await svc.searchInConversation('conv1', 'org1', 'disney', 50, 'ALL');

    expect(repository.searchInConversations).toHaveBeenCalledWith(
      ['conv1', 'conv2'],
      'disney',
      50,
    );
  });

  it('conversa normal busca só nela mesma', async () => {
    const { svc, repository } = makeService(CONVERSATION);

    await svc.searchInConversation('conv1', 'org1', 'disney', 50, 'ALL');

    expect(repository.searchInConversations).toHaveBeenCalledWith(
      ['conv1'],
      'disney',
      50,
    );
  });

  // Termo vazio nem chega ao banco: "%%" casaria a conversa inteira.
  it('termo em branco devolve vazio sem consultar o banco', async () => {
    const { svc, repository } = makeService(CONVERSATION);

    const out = await svc.searchInConversation('conv1', 'org1', '   ', 50, 'ALL');

    expect(out).toEqual({ messages: [] });
    expect(repository.searchInConversations).not.toHaveBeenCalled();
  });
});
