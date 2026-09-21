import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { RealtimeGateway } from '../../realtime/realtime.gateway';
import { ConversationFsmService } from '../conversations/conversation-fsm.service';

export interface LegacyRouteParams {
  organizationId: string;
  conversationId: string;
  contactId: string;
}

export type LegacyRouteResult =
  | { routed: true; userId: string; vendedor: string }
  | { routed: false; reason: 'no_phone' | 'not_found' }
  | { routed: false; reason: 'unmapped' | 'inactive'; vendedor: string };

interface LegacyOwnerRow {
  vendedor: string | null;
  etapa: string | null;
  tags: string | null;
  user_id: string | null;
}

/**
 * Carteira legada: cliente que já era de um vendedor na planilha antiga
 * (tabela `contatos_legado`) volta direto para ele quando abre conversa nova.
 * Pula a triagem da Aline e a fila "Distribuir".
 *
 * O nome da planilha ("Renata", "Carol"...) vira usuário pela tabela
 * `contatos_legado_vendedores`. Sem mapeamento, ou com o vendedor inativo /
 * fora da organização, a conversa segue o fluxo normal.
 */
@Injectable()
export class LegacyOwnerRoutingService {
  private readonly logger = new Logger(LegacyOwnerRoutingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fsm: ConversationFsmService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async routeNewConversation(params: LegacyRouteParams): Promise<LegacyRouteResult> {
    const { organizationId, conversationId, contactId } = params;

    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      select: { phone: true },
    });
    if (!contact?.phone) return { routed: false, reason: 'no_phone' };

    const [owner] = await this.prisma.$queryRaw<LegacyOwnerRow[]>`
      SELECT l.vendedor, l.etapa, l.tags, m.user_id
      FROM buscar_vendedor_legado(${contact.phone}) l
      LEFT JOIN contatos_legado_vendedores m ON m.vendedor = l.vendedor`;
    if (!owner?.vendedor) return { routed: false, reason: 'not_found' };

    const vendedor = owner.vendedor;
    if (!owner.user_id) {
      this.logger.warn(
        `legado: vendedor "${vendedor}" sem usuário mapeado — distribuição normal (conv=${conversationId})`,
      );
      return { routed: false, reason: 'unmapped', vendedor };
    }

    const member = await this.prisma.userOrganization.findFirst({
      where: {
        organizationId,
        userId: owner.user_id,
        user: { isActive: true, deletedAt: null },
      },
      select: { id: true },
    });
    if (!member) {
      this.logger.log(
        `legado: vendedor "${vendedor}" inativo ou fora da org — distribuição normal (conv=${conversationId})`,
      );
      return { routed: false, reason: 'inactive', vendedor };
    }

    // Atribui antes de desligar a IA: se a atribuição perder uma corrida, a
    // conversa continua com a Aline em vez de ficar sem ninguém.
    await this.fsm.assign(conversationId, owner.user_id);
    // `shouldHandle` da IA ignora `assignedToId`: sem isto a Aline responderia
    // por cima do vendedor.
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { aiEnabled: false, activeAgentId: null },
    });
    this.realtime.emitToChannel(updated.channelId, 'conversation:updated', {
      conversation: updated,
    });
    this.realtime.emitToConversation(conversationId, 'conversation:updated', {
      conversation: updated,
    });

    this.logger.log(
      `legado: conv=${conversationId} atribuída a "${vendedor}" (user=${owner.user_id})`,
    );
    return { routed: true, userId: owner.user_id, vendedor };
  }
}
