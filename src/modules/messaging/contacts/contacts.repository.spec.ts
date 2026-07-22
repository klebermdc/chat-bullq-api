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
    expect(arg.include.conversations.where).toEqual({ assignedToId: 'agent-u1' });
  });
});
