import { Injectable, Logger } from '@nestjs/common';
import { Channel, NotificationType, OrgRole } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AccountUpdate } from './ports/types';

/**
 * Eventos de nível de CONTA (WABA) vindos do webhook `account_update`.
 *
 * Sem isto, o modo de falha é silencioso: o cliente nos desconecta ou é banido,
 * o canal continua marcado como "Ativo" na interface, as mensagens param de
 * chegar, e a gente só descobre quando ele reclama — sem nenhuma pista de por
 * onde começar. Mesma família do apagão que o fail-loud do channel-hub resolveu.
 *
 * Vira obrigatório na coexistência (a Meta exige a assinatura do tópico), mas
 * vale pra qualquer canal oficial.
 */
@Injectable()
export class AccountUpdateService {
  private readonly logger = new Logger(AccountUpdateService.name);

  /**
   * Eventos que significam "este canal parou de funcionar AGORA". Merecem
   * desativar o canal, e não só avisar: deixá-lo "Ativo" faz o operador
   * perder tempo procurando o problema no lugar errado.
   */
  private static readonly FATAL_EVENTS = new Set([
    'PARTNER_REMOVED', // o cliente revogou nosso acesso
    'DISABLED_UPDATE', // WABA desabilitada pela Meta
    'ACCOUNT_DELETED',
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async handle(channel: Channel, update: AccountUpdate): Promise<void> {
    const fatal = AccountUpdateService.FATAL_EVENTS.has(update.event);

    // O payload cru já foi persistido em `webhook_events` pelo gateway antes
    // do parse, então a auditoria existe mesmo que o resto daqui falhe.
    this.logger.warn(
      `account_update no canal ${channel.id} (${channel.name}): ${update.event}` +
        (update.phoneNumber ? ` — número ${update.phoneNumber}` : '') +
        (fatal ? ' [FATAL — desativando o canal]' : ''),
    );

    if (fatal && channel.isActive) {
      await this.prisma.channel.update({
        where: { id: channel.id },
        data: { isActive: false },
      });
    }

    await this.notifications
      .notifyOrgAgents({
        organizationId: channel.organizationId,
        // Só quem pode agir: reconectar um canal é ação de dono/admin.
        roles: [OrgRole.OWNER, OrgRole.ADMIN],
        type: NotificationType.SYSTEM,
        title: fatal
          ? `Canal "${channel.name}" foi desconectado`
          : `Aviso da Meta no canal "${channel.name}"`,
        body: fatal
          ? `A Meta informou "${update.event}". O canal foi desativado e não recebe nem envia mensagens até ser reconectado.`
          : `A Meta informou "${update.event}"${update.phoneNumber ? ` no número ${update.phoneNumber}` : ''}.`,
        data: {
          channelId: channel.id,
          event: update.event,
          businessAccountId: update.businessAccountId,
          phoneNumber: update.phoneNumber,
        },
      })
      .catch((err) =>
        // Não deixa a notificação derrubar a desativação, que é o que importa.
        this.logger.error(
          `Falha ao notificar account_update do canal ${channel.id}: ${err.message}`,
        ),
      );
  }
}
