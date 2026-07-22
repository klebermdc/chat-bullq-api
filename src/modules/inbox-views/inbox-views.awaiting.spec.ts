import { InboxViewsService } from './inbox-views.service';
import { ConversationsService } from '../messaging/conversations/conversations.service';

/**
 * Filtro "fila de atendimento" numa inbox view — o mesmo sinal das abas
 * Esperando/Caixa de entrada (`awaitingHumanReply`), mas fixado na view.
 * É o que faz a inbox "Distribuição" mostrar a fila de handoff: leads que
 * a IA passou pro humano e ainda não têm dono.
 */
describe('Inbox view — filtro awaitingHumanReply (fila de distribuição)', () => {
  const ORG = 'org-1';
  const USER = 'user-1';

  const buildService = (viewFilters: Record<string, any>, findInbox: jest.Mock) => {
    const prisma = {
      inboxView: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'view-1',
          organizationId: ORG,
          userId: USER,
          filters: viewFilters,
        }),
      },
    };
    return new InboxViewsService(prisma as any, { findInbox } as any);
  };

  const okInbox = () =>
    jest.fn().mockResolvedValue({
      conversations: [],
      pagination: { page: 1, limit: 30, total: 0, totalPages: 0 },
    });

  it('repassa o flag da view (fila de distribuição = esperando + sem dono)', async () => {
    const findInbox = okInbox();
    const service = buildService(
      { awaitingHumanReply: true, assignedTo: 'none' },
      findInbox,
    );

    await service.findConversations('view-1', ORG, USER, 'ALL', 1, 30);

    const filters = findInbox.mock.calls[0][1];
    expect(filters.awaitingHumanReply).toBe(true);
    expect(filters.assignedToNone).toBe(true);
  });

  it('não filtra por fila quando a view não usa o campo', async () => {
    const findInbox = okInbox();
    const service = buildService({ unreadOnly: true }, findInbox);

    await service.findConversations('view-1', ORG, USER, 'ALL', 1, 30);

    expect(findInbox.mock.calls[0][1].awaitingHumanReply).toBeUndefined();
  });
});

describe('ConversationsService.findInbox — awaitingHumanReply fora das abas', () => {
  const buildService = (findInboxRepo: jest.Mock) => {
    const repository = { findInbox: findInboxRepo };
    const service = Object.create(ConversationsService.prototype);
    (service as any).repository = repository;
    (service as any).attachProjects = jest.fn().mockResolvedValue(undefined);
    return service as ConversationsService;
  };

  const repoOk = () =>
    jest.fn().mockResolvedValue({ conversations: [], total: 0 });

  it('exclui conversas fechadas (fechada não espera ninguém)', async () => {
    const repo = repoOk();
    const service = buildService(repo);

    await service.findInbox('org-1', { awaitingHumanReply: true }, 1, 30);

    const args = repo.mock.calls[0][0];
    expect(args.awaitingHumanReply).toBe(true);
    expect(args.excludeClosed).toBe(true);
  });

  it('um status explícito na view continua tendo precedência', async () => {
    const repo = repoOk();
    const service = buildService(repo);

    await service.findInbox(
      'org-1',
      { awaitingHumanReply: true, status: 'CLOSED' },
      1,
      30,
    );

    expect(repo.mock.calls[0][0].status).toEqual(['CLOSED']);
  });

  it('o flag da view vence a aba quando os dois chegam juntos', async () => {
    const repo = repoOk();
    const service = buildService(repo);

    await service.findInbox(
      'org-1',
      { tab: 'inbox', awaitingHumanReply: true },
      1,
      30,
    );

    expect(repo.mock.calls[0][0].awaitingHumanReply).toBe(true);
  });
});
