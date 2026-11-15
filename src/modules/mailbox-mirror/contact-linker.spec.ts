import { MailboxContactRole } from '@prisma/client';
import { buildContactLinks, findContactsByEmail } from './contact-linker';

describe('findContactsByEmail', () => {
  it('não consulta o banco sem endereços', async () => {
    const prisma = { $queryRaw: jest.fn() };
    expect(await findContactsByEmail(prisma as never, 'org1', [])).toEqual([]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('compara sem diferenciar maiúsculas, na org, sem apagados nem cliente oculto', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ id: 'c1', email: 'ana@gmail.com' }]) };

    const result = await findContactsByEmail(prisma as never, 'org1', ['ana@gmail.com', 'ana@gmail.com']);

    expect(result).toEqual([{ id: 'c1', email: 'ana@gmail.com' }]);
    const query = prisma.$queryRaw.mock.calls[0][0];
    expect(query.sql).toContain('LOWER(TRIM(email)) = ANY(');
    expect(query.sql).toContain('deleted_at IS NULL');
    expect(query.sql).toContain('is_mystery_shopper = false');
    expect(query.values).toEqual(['org1', ['ana@gmail.com']]);
  });
});

describe('buildContactLinks', () => {
  it('liga cada contato ao papel em que o endereço apareceu, inclusive contatos com o mesmo e-mail', () => {
    const links = buildContactLinks(
      [
        { address: 'ana@gmail.com', role: MailboxContactRole.FROM },
        { address: 'ana@gmail.com', role: MailboxContactRole.CC },
        { address: 'ninguem@gmail.com', role: MailboxContactRole.TO },
      ],
      [
        { id: 'c1', email: 'ana@gmail.com' },
        { id: 'c2', email: 'ana@gmail.com' },
      ],
    );

    expect(links).toEqual([
      { contactId: 'c1', role: MailboxContactRole.FROM },
      { contactId: 'c2', role: MailboxContactRole.FROM },
      { contactId: 'c1', role: MailboxContactRole.CC },
      { contactId: 'c2', role: MailboxContactRole.CC },
    ]);
  });
});
