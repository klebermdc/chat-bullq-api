import { OrgRole } from '@prisma/client';
import { resolveAssignmentScope } from '../messaging/conversations/conversation-scope';

/**
 * Cláusula `where` que limita cards ao que o usuário pode ver.
 *
 * OWNER/ADMIN → `{}` (sem barreira).
 * AGENT (ou role ausente → fail-closed) → card cuja CONVERSA é dele, ou cujo
 * próprio `assignedToId` é dele. O OR existe porque `card.assignedTo` costuma
 * ficar vazio: o dono real do lead vive em `conversation.assignedTo`. Sem o
 * segundo braço, card avulso (sem conversa) sumiria do board do vendedor.
 *
 * Card sem dono nos dois lados NÃO aparece para o AGENT — coerente com a regra
 * do Inbox, onde a fila de não-atribuídas é de Admin/Owner.
 */
export function pipelineCardScopeWhere(
  role: OrgRole | undefined,
  userId: string,
): Record<string, unknown> {
  const scoped = resolveAssignmentScope(role, userId);
  if (!scoped) return {};
  return {
    OR: [{ conversation: { assignedToId: scoped } }, { assignedToId: scoped }],
  };
}
