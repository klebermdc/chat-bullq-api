import { scopedUserWhere } from '../conversations/conversation-scope';
import { ContactsRepository } from './contacts.repository';

describe('ContactsRepository.findById — filtro de conversas por atribuição', () => {
  function make() {
    const prisma: any = {
      contact: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) },
    };
    return { repo: new ContactsRepository(prisma), prisma };
  }

  it('sem scopedUserId (OWNER/ADMIN/system): inclui conversations SEM cláusula where', async () => {
    const { repo, prisma } = make();
    await repo.findById('c1');
    const arg = prisma.contact.findFirst.mock.calls[0][0];
    expect(arg.include.conversations.where).toBeUndefined();
  });

  it('com scopedUserId (AGENT): filtra conversations por assignedToId', async () => {
    const { repo, prisma } = make();
    await repo.findById('c1', 'agent-u1');
    const arg = prisma.contact.findFirst.mock.calls[0][0];
    expect(arg.include.conversations.where).toEqual({ ...scopedUserWhere('agent-u1') });
  });
});

describe('ContactsRepository.findByOrg — busca', () => {
  const build = (rawRows: Array<{ id: string; total: bigint }>) => {
    const findMany = jest.fn().mockImplementation(({ where }) =>
      Promise.resolve((where.id?.in ?? []).map((id: string) => ({ id }))),
    );
    const count = jest.fn().mockResolvedValue(7);
    const prisma = {
      contact: { findMany, count },
      $queryRaw: jest.fn().mockResolvedValue(rawRows),
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    };
    return { repo: new ContactsRepository(prisma as any), prisma, findMany };
  };

  it('com termo, usa a busca de contatos e mantém a ordem dela', async () => {
    const { repo, findMany } = build([
      { id: 'b', total: BigInt(2) },
      { id: 'a', total: BigInt(2) },
    ]);
    findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);

    const out = await repo.findByOrg('org-1', 'joao silva', 0, 20);

    expect(out).toEqual({ contacts: [{ id: 'b' }, { id: 'a' }], total: 2 });
    expect(findMany.mock.calls[0][0].where).toEqual({ id: { in: ['b', 'a'] } });
  });

  it('com termo e nada achado, não busca a página', async () => {
    const { repo, findMany } = build([]);

    const out = await repo.findByOrg('org-1', 'ninguém', 0, 20);

    expect(out).toEqual({ contacts: [], total: 0 });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('sem termo, lista como antes', async () => {
    const { repo, prisma, findMany } = build([]);

    await repo.findByOrg('org-1', undefined, 0, 20);

    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1', deletedAt: null });
  });
});
