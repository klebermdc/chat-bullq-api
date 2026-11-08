/**
 * Origem de uma atribuição, gravada em `metadata.source` do log ASSIGNED.
 * O placar do dia separa cliente novo liberado (`distribution`) de retorno
 * (todo o resto).
 */
export type AssignmentSource = 'distribution' | 'legacy_owner' | 'transfer' | 'self' | 'automation';

export interface AssignmentChange {
  fromValue: string | null;
  toValue: string;
  actorId: string | null | undefined;
}

/**
 * Origem quando o chamador não informa: de outro vendedor é transferência;
 * o próprio vendedor pegando da fila é `self`; outra pessoa entregando da
 * fila é distribuição.
 */
export function deriveAssignmentSource({ fromValue, toValue, actorId }: AssignmentChange): AssignmentSource {
  if (fromValue && fromValue !== toValue) return 'transfer';
  if (actorId === toValue) return 'self';
  return 'distribution';
}
