import { Injectable, Logger } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
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
   * Regra "tudo que chega na org": TODA mensagem genuína de cliente notifica
   * TODOS os atendentes da org (atribuída a quem for). Assim o som não fica
   * intermitente — quem estiver disponível é alertado de qualquer mensagem
   * nova. O barulho é contido em duas camadas: a supressão no frontend
   * (não toca na conversa que o atendente já está olhando) e o som/DND por
   * usuário. `assignedToId`/`isNewConversation` no input são mantidos por
   * compatibilidade do chamador, mas não influenciam mais o roteamento.
   */
  async onInboundMessage(input: InboundNotifyInput): Promise<void> {
    try {
      const title = input.contactName || 'Nova mensagem';
      const body = input.preview?.slice(0, 140) || 'Enviou uma mensagem';
      const data = { conversationId: input.conversationId };

      await this.notifications.notifyOrgAgents({
        organizationId: input.organizationId,
        type: NotificationType.NEW_MESSAGE,
        title,
        body,
        data,
      });
    } catch (err: any) {
      this.logger.warn(`inbound notify falhou (não crítico): ${err?.message}`);
    }
  }
}
