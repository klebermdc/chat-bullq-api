import { MailboxContactRole } from '@prisma/client';

/** Endereço como o mailparser entrega (com grupos aninhados). */
export interface RawAddress {
  address?: string;
  name?: string;
  group?: RawAddress[];
}

export interface RoleAddress {
  address: string;
  role: MailboxContactRole;
}

export interface AddressHeaders {
  from: RawAddress[];
  replyTo: RawAddress[];
  to: RawAddress[];
  cc: RawAddress[];
}

const SIMPLE_EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** Minúsculas, sem espaços nem `< >`. null quando não parece e-mail. */
export function normalizeEmailAddress(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^<|>$/g, '').trim().toLowerCase();
  return SIMPLE_EMAIL.test(cleaned) ? cleaned : null;
}

export function domainOf(address: string): string {
  const at = address.lastIndexOf('@');
  return address.slice(at + 1).trim().toLowerCase();
}

function flatten(list: RawAddress[]): string[] {
  return list.flatMap((item) => [
    ...(item.address ? [item.address] : []),
    ...flatten(item.group ?? []),
  ]);
}

/** Ordem importa: o mesmo endereço pode aparecer em mais de um papel. */
const ROLE_ORDER: ReadonlyArray<[keyof AddressHeaders, MailboxContactRole]> = [
  ['from', MailboxContactRole.FROM],
  ['replyTo', MailboxContactRole.REPLY_TO],
  ['to', MailboxContactRole.TO],
  ['cc', MailboxContactRole.CC],
];

/** Todos os endereços válidos com o papel, sem repetir o par (endereço, papel). */
export function collectRoleAddresses(headers: AddressHeaders): RoleAddress[] {
  const pairs = ROLE_ORDER.flatMap(([field, role]) =>
    flatten(headers[field])
      .map(normalizeEmailAddress)
      .filter((address): address is string => address !== null)
      .map((address) => ({ address, role })),
  );
  const seen = new Set<string>();
  return pairs.filter((pair) => {
    const key = `${pair.role}:${pair.address}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Tira o que é da casa: a própria caixa, o domínio dela (os colegas da OFP)
 * e os domínios extras configurados. Só sobra quem pode ser cliente.
 */
export function linkableAddresses(
  addresses: RoleAddress[],
  mailbox: { address: string; ignoredDomains: string[] },
): RoleAddress[] {
  const ownAddress = normalizeEmailAddress(mailbox.address);
  const ignored = new Set([
    domainOf(mailbox.address),
    ...mailbox.ignoredDomains.map((d) => d.trim().toLowerCase()),
  ]);
  return addresses.filter(
    (item) => item.address !== ownAddress && !ignored.has(domainOf(item.address)),
  );
}
