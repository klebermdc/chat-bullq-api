import { OrgRole, type Prisma } from '@prisma/client';

/** Quem está pedindo: id do usuário e papel dele na org atual. */
export type ContractActor = { userId: string; role: OrgRole | undefined };

const STAFF_ROLES: readonly OrgRole[] = [OrgRole.OWNER, OrgRole.ADMIN];

export function isStaff(actor: ContractActor): boolean {
  return actor.role !== undefined && STAFF_ROLES.includes(actor.role);
}

/**
 * Filtro extra de visibilidade: staff vê a org toda; AGENT (ou papel
 * desconhecido, por segurança) só os contratos que ele criou. Contratos sem
 * criador, como os importados do legado, ficam invisíveis para AGENT.
 */
export function actorScope(actor: ContractActor): Prisma.ContractWhereInput {
  return isStaff(actor) ? {} : { createdById: actor.userId };
}
