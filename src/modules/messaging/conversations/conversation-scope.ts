import { OrgRole, Prisma, PrismaClient } from '@prisma/client';

/**
 * Decide o escopo de visibilidade por atribuição.
 * - OWNER/ADMIN: acesso amplo → `undefined` (sem barreira de atribuição).
 * - AGENT (ou role ausente → fail-closed): escopado ao próprio userId.
 * Retorna o valor a usar em `enforceAssignedToId`.
 */
export function resolveAssignmentScope(
  role: OrgRole | undefined,
  userId: string,
): string | undefined {
  if (role === OrgRole.OWNER || role === OrgRole.ADMIN) return undefined;
  return userId;
}

/**
 * Conversas que um AGENT alcança: a dele OU uma em que foi incluído (conversa
 * compartilhada). Recebe o userId já escopado (`enforceAssignedToId`).
 * `ownedOnly` restringe à própria.
 */
export function scopedUserWhere(
  scopedUserId: string,
  opts: { ownedOnly?: boolean } = {},
): Prisma.ConversationWhereInput {
  if (opts.ownedOnly) return { assignedToId: scopedUserId };
  return {
    OR: [
      { assignedToId: scopedUserId },
      { participants: { some: { userId: scopedUserId } } },
    ],
  };
}

type ParticipantReader = Pick<PrismaClient, 'conversationParticipant'>;

/**
 * Checagem para quem já carregou a conversa: dono passa direto; senão, uma
 * consulta pela chave única (conversa, usuário).
 */
export async function canAgentReachConversation(
  prisma: ParticipantReader,
  conversation: { id: string; assignedToId: string | null },
  userId: string,
): Promise<boolean> {
  if (conversation.assignedToId === userId) return true;
  const row = await prisma.conversationParticipant.findUnique({
    where: {
      conversationId_userId: { conversationId: conversation.id, userId },
    },
    select: { id: true },
  });
  return !!row;
}

/**
 * Bloco da inbox para um AGENT, combinando a barreira com a aba:
 * - Esperando (`awaiting = true`): só a conversa dele esperando resposta.
 * - Caixa de entrada (`awaiting = false`): a dele já respondida + TODAS as
 *   compartilhadas abertas, esperando ou não — senão a compartilhada sumiria
 *   da tela de quem ajuda justo quando o cliente escreve.
 * - Sem aba: dono OU incluído.
 */
export function agentScopeBlock(
  scopedUserId: string,
  awaiting: boolean | undefined,
): Prisma.ConversationWhereInput {
  if (awaiting === true) {
    return { assignedToId: scopedUserId, awaitingHumanReply: true };
  }
  if (awaiting === false) {
    return {
      OR: [
        { assignedToId: scopedUserId, awaitingHumanReply: false },
        { participants: { some: { userId: scopedUserId } } },
      ],
    };
  }
  return scopedUserWhere(scopedUserId);
}
