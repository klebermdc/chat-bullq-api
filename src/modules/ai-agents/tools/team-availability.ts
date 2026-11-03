import { Logger } from '@nestjs/common';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { groupPresence, presenceStatus } from '../../team-presence/presence.util';

const logger = new Logger('TeamAvailability');

/**
 * Alguém da equipe da org está ativo no Chat agora? "Online" = mexeu no Chat
 * nos últimos 5 min (mesma regra do painel Equipe agora); aba aberta e parada
 * não conta. Canal de urgência e chamado de suporte só existem sem ninguém
 * online.
 *
 * Se a presença não puder ser lida, responde false (offline): o cliente não
 * pode ficar sem saída por falha nossa.
 */
export async function isTeamOnline(
  realtime: RealtimeGateway,
  organizationId: string,
  now: Date,
): Promise<boolean> {
  try {
    const sockets = await realtime.listSocketPresence();
    return groupPresence(sockets).some(
      (p) => p.organizationId === organizationId && presenceStatus(p.lastActiveAt, now) === 'online',
    );
  } catch (err) {
    logger.error(`presença indisponível org=${organizationId}: ${(err as Error).message}`);
    return false;
  }
}
