import { MailboxContactRole, Prisma } from '@prisma/client';
import type { RoleAddress } from './email-address.util';

export interface ContactEmailRow {
  id: string;
  /** Já normalizado (minúsculas, sem espaços). */
  email: string;
}

export interface ContactLink {
  contactId: string;
  role: MailboxContactRole;
}

type RawQuerier = { $queryRaw<T>(query: Prisma.Sql): Prisma.PrismaPromise<T> };

/**
 * Contatos da org cujo e-mail bate com algum dos endereços.
 *
 * O e-mail do contato é gravado como foi digitado, então a comparação é
 * `LOWER(TRIM(email))` — a mesma expressão do índice
 * `contacts_org_email_lower_idx` (migração 20261115120000); mudar uma sem a
 * outra faz o Postgres varrer a tabela. Cliente oculto fica de fora.
 */
export async function findContactsByEmail(
  prisma: RawQuerier,
  organizationId: string,
  addresses: string[],
): Promise<ContactEmailRow[]> {
  const unique = [...new Set(addresses)];
  if (unique.length === 0) return [];
  return prisma.$queryRaw<ContactEmailRow[]>(Prisma.sql`
    SELECT id, LOWER(TRIM(email)) AS email
    FROM contacts
    WHERE organization_id = ${organizationId}
      AND email IS NOT NULL
      AND deleted_at IS NULL
      AND is_mystery_shopper = false
      AND LOWER(TRIM(email)) = ANY(${unique}::text[])
  `);
}

/** Um vínculo por (contato, papel) para cada endereço que achou contato. */
export function buildContactLinks(
  addresses: RoleAddress[],
  contacts: ContactEmailRow[],
): ContactLink[] {
  return addresses.flatMap(({ address, role }) =>
    contacts.filter((c) => c.email === address).map((c) => ({ contactId: c.id, role })),
  );
}
