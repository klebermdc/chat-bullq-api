import { OrgRole } from '@prisma/client';

/**
 * Decide se um atendente que ACABOU de responder deve virar dono da conversa.
 *
 * Regra base: quem responde assume ("whoever replies owns the conversation").
 * EXCEÇÃO: ADM/Owner NÃO rouba conversa que já tem dono — quando um gestor
 * entra só pra intervir/responder, o cliente permanece com o agente de direito.
 * Se a conversa está órfã (sem dono), o ADM/Owner assume normalmente.
 *
 * Role ausente é tratado como AGENT (fail-closed): preserva o comportamento
 * legado de auto-assumir para chamadas internas que não passam role.
 */
export function shouldAutoAssignOnReply(params: {
  currentAssigneeId: string | null;
  senderId: string;
  role?: OrgRole;
}): boolean {
  const { currentAssigneeId, senderId, role } = params;

  // Já é o dono → no-op.
  if (currentAssigneeId === senderId) return false;

  const isPrivileged = role === OrgRole.OWNER || role === OrgRole.ADMIN;
  const conversationHasOwner = currentAssigneeId != null;

  // ADM/Owner respondendo conversa que já tem dono não rouba.
  if (isPrivileged && conversationHasOwner) return false;

  return true;
}
