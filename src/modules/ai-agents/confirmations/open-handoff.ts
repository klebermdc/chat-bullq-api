import type { PrismaService } from '../../../database/prisma.service';

export const TRANSFER_TO_HUMAN_TOOL = 'transferToHuman';

/**
 * A IA já pediu transferência nesta conversa e o operador ainda não decidiu
 * (nem venceu). Enquanto isso, a IA fica quieta: ela já avisou o cliente que
 * um humano vai seguir, e rodar de novo só gerava outro card de transferência.
 */
export async function hasOpenHandoff(
  prisma: PrismaService,
  conversationId: string,
): Promise<boolean> {
  const open = await prisma.aiPendingAction.findFirst({
    where: {
      conversationId,
      toolName: TRANSFER_TO_HUMAN_TOOL,
      status: 'PENDING',
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  return open !== null;
}
