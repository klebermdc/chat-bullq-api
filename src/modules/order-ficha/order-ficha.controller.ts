import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg } from '../../common/decorators';
import { OrderFichaRepository } from './order-ficha.repository';

@ApiTags('Order Ficha')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('order-ficha')
export class OrderFichaController {
  constructor(private readonly repo: OrderFichaRepository) {}

  /**
   * Ficha do pedido de uma conversa. `findByConversation` não filtra por
   * organização (a chave é só `conversationId`), então o org-scope é
   * verificado aqui — mesmo padrão de `ProposalsService.listForConversation`,
   * que devolve vazio (em vez de 403/404) quando a conversa é de outra org.
   */
  @Get('conversation/:conversationId')
  async getForConversation(
    @Param('conversationId') conversationId: string,
    @CurrentOrg('id') orgId?: string,
  ) {
    const ficha = await this.repo.findByConversation(conversationId);
    if (!ficha || ficha.organizationId !== orgId) return null;
    return ficha;
  }
}
