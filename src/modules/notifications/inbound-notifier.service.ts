import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, OrgRole } from '@prisma/client';
import { NotificationsService } from './notifications.service';

export interface InboundNotifyInput {
  organizationId: string;
  conversationId: string;
  contactName: string;
  preview: string;
  assignedToId: string | null;
  isNewConversation: boolean;
}

@Injectable()
export class InboundNotifierService {
  private readonly logger = new Logger(InboundNotifierService.name);

  constructor(private readonly notifications: NotificationsService) {}

  /**
   * Best-effort: cria a notificação NEW_MESSAGE. Nunca lança — notificação
   * quebrada não pode derrubar o pipeline de mensagem.
   *
   * Roteamento POR ATENDENTE (só o dono ouve, não a org toda):
   *  - conversa ATRIBUÍDA → notifica APENAS o atendente responsável.
   *  - conversa SEM DONO, só na 1ª mensagem (lead novo entrando) → notifica
   *    APENAS o OWNER. Atendentes não têm acesso à fila de distribuição, então
   *    não faz sentido alertá-los de lead que ainda não é deles. Mensagens
   *    seguintes de conversa sem dono NÃO re-notificam (evita barulho).
   */
  async onInboundMessage(input: InboundNotifyInput): Promise<void> {
    try {
      const title = input.contactName || 'Nova mensagem';
      const body = input.preview?.slice(0, 140) || 'Enviou uma mensagem';
      const data = { conversationId: input.conversationId };

      if (input.assignedToId) {
        await this.notifications.notify({
          recipientId: input.assignedToId,
          organizationId: input.organizationId,
          type: NotificationType.NEW_MESSAGE,
          title,
          body,
          data,
        });
        return;
      }

      if (input.isNewConversation) {
        await this.notifications.notifyOrgAgents({
          organizationId: input.organizationId,
          roles: [OrgRole.OWNER],
          type: NotificationType.NEW_MESSAGE,
          title,
          body,
          data,
        });
      }
    } catch (err: any) {
      this.logger.warn(`inbound notify falhou (não crítico): ${err?.message}`);
    }
  }
}
