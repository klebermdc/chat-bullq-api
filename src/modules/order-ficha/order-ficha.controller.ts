import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser, CurrentUserRole } from '../../common/decorators';
import { PrismaService } from '../../database/prisma.service';
import { resolveAssignmentScope } from '../messaging/conversations/conversation-scope';
import { OrderFichaRepository } from './order-ficha.repository';

@ApiTags('Order Ficha')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('order-ficha')
export class OrderFichaController {
  constructor(
    private readonly repo: OrderFichaRepository,
    // Injeta PrismaService direto (não ConversationsService) pra evitar um
    // ciclo de módulo novo: OrderFichaModule é importado por MessagingModule
    // sem forwardRef hoje (comentário em proposals.module.ts confirma "sem
    // ciclo"), e ConversationsService só sai via MessagingModule. A checagem
    // em si é a mesma lógica de `assertConversationAccess` (resolveAssignmentScope
    // + findFirst escopado), só que devolve `null` (mesmo padrão do resto
    // deste handler) em vez de lançar NotFoundException.
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Ficha do pedido de uma conversa. `findByConversation` não filtra por
   * organização (a chave é só `conversationId`), então o org-scope é
   * verificado aqui — mesmo padrão de `ProposalsService.listForConversation`,
   * que devolve vazio (em vez de 403/404) quando a conversa é de outra org.
   *
   * Mesma ideia pro escopo de atribuição: AGENT só vê a ficha se a conversa
   * estiver atribuída a ele. OWNER/ADMIN não filtra (resolveAssignmentScope
   * devolve `undefined`).
   */
  @Get('conversation/:conversationId')
  async getForConversation(
    @Param('conversationId') conversationId: string,
    @CurrentOrg('id') orgId?: string,
    @CurrentUserRole() role?: OrgRole,
    @CurrentUser('id') userId?: string,
  ) {
    const ficha = await this.repo.findByConversation(conversationId);
    if (!ficha || ficha.organizationId !== orgId) return null;

    const scoped = userId ? resolveAssignmentScope(role, userId) : undefined;
    if (scoped) {
      const conversation = await this.prisma.conversation.findFirst({
        where: { id: conversationId, organizationId: orgId, assignedToId: scoped },
        select: { id: true },
      });
      if (!conversation) return null;
    }

    return ficha;
  }
}
