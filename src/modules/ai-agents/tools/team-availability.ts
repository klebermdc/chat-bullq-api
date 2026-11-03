import { Logger } from "@nestjs/common";
import { PrismaService } from "../../../database/prisma.service";
import { RealtimeGateway } from "../../realtime/realtime.gateway";
import {
  groupPresence,
  presenceStatus,
} from "../../team-presence/presence.util";

const logger = new Logger("TeamAvailability");

/**
 * O vendedor DESTE cliente está ativo no Chat agora? Só ele conta: colega
 * online não atende passageiro que não é dele, então para o canal de
 * urgência e o chamado de suporte é como se ninguém estivesse online.
 * Conversa sem vendedor não é de ninguém: responde false.
 *
 * "Online" = mexeu no Chat nos últimos 5 min (mesma regra do painel Equipe
 * agora); aba aberta e parada não conta. Se a presença não puder ser lida,
 * responde false: o cliente não pode ficar sem saída por falha nossa.
 */
export async function isSellerOnline(
  prisma: PrismaService,
  realtime: RealtimeGateway,
  ctx: { organizationId: string; conversationId: string },
  now: Date,
): Promise<boolean> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: ctx.conversationId },
    select: { assignedToId: true },
  });
  const sellerId = conversation?.assignedToId;
  if (!sellerId) return false;
  try {
    const sockets = await realtime.listSocketPresence();
    return groupPresence(sockets).some(
      (p) =>
        p.organizationId === ctx.organizationId &&
        p.userId === sellerId &&
        presenceStatus(p.lastActiveAt, now) === "online",
    );
  } catch (err) {
    logger.error(
      `presença indisponível org=${ctx.organizationId}: ${(err as Error).message}`,
    );
    return false;
  }
}
