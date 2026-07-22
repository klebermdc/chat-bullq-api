import { InboxViewsService } from './inbox-views.service';
import { ConversationsRepository } from '../messaging/conversations/conversations.repository';

/**
 * Regressão: uma inbox view salva com "Atribuição: Não atribuída"
 * (`filters.assignedTo = 'none'`) voltava SEMPRE vazia.
 *
 * A service traduzia o token `none` para a STRING `'null'` e o repositório
 * mandava isso pro Prisma como `where.assignedToId = 'null'` — comparação de
 * texto contra uma coluna UUID, que nunca casa com nenhuma linha. É o caso da
 * inbox "Distribuição" (leads sem dono, prontos pra distribuir).
 */
describe('Inbox view "Não atribuída" (assignedTo: none)', () => {
  const ORG = 'org-1';
  const USER = 'user-1';
  const VIEW = {
    id: 'view-1',
    organizationId: ORG,
    userId: USER,
    filters: { assignedTo: 'none' },
  };

  const buildService = (findInbox: jest.Mock) => {
    const prisma = {
      inboxView: {
        findUnique: jest.fn().mockResolvedValue(VIEW),
      },
    };
    return new InboxViewsService(prisma as any, { findInbox } as any);
  };

  it('não vaza a string "null" como assignedToId — sinaliza "sem responsável"', async () => {
    const findInbox = jest.fn().mockResolvedValue({
      conversations: [],
      pagination: { page: 1, limit: 30, total: 0, totalPages: 0 },
    });
    const service = buildService(findInbox);

    await service.findConversations(VIEW.id, ORG, USER, 'ALL', 1, 30);

    const filters = findInbox.mock.calls[0][1];
    expect(filters.assignedToId).toBeUndefined();
    expect(filters.assignedToNone).toBe(true);
  });

  it('um override explícito de atendente vence o filtro salvo da view', async () => {
    const findInbox = jest.fn().mockResolvedValue({
      conversations: [],
      pagination: { page: 1, limit: 30, total: 0, totalPages: 0 },
    });
    const service = buildService(findInbox);

    await service.findConversations(VIEW.id, ORG, USER, 'ALL', 1, 30, undefined, {
      assignedToId: 'user-barbara',
    });

    const filters = findInbox.mock.calls[0][1];
    expect(filters.assignedToId).toBe('user-barbara');
    expect(filters.assignedToNone).toBeFalsy();
  });
});

describe('ConversationsRepository.findInbox — filtro "sem responsável"', () => {
  const buildRepo = () => {
    const findMany = jest.fn();
    const count = jest.fn();
    const prisma = {
      conversation: { findMany, count },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    };
    return { repo: new ConversationsRepository(prisma as any), findMany };
  };

  it('traduz assignedToNone para SQL NULL (conversas sem dono)', async () => {
    const { repo, findMany } = buildRepo();

    await repo.findInbox(
      { organizationId: 'org-1', assignedToNone: true },
      0,
      30,
    );

    expect(findMany.mock.calls[0][0].where.assignedToId).toBeNull();
  });

  it('a barreira do AGENT (enforceAssignedToId) vence o "sem responsável"', async () => {
    const { repo, findMany } = buildRepo();

    await repo.findInbox(
      {
        organizationId: 'org-1',
        assignedToNone: true,
        enforceAssignedToId: 'user-agent',
      },
      0,
      30,
    );

    expect(findMany.mock.calls[0][0].where.assignedToId).toBe('user-agent');
  });
});
