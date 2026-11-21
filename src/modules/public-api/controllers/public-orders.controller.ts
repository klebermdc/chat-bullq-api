import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../../../common/guards';
import { CurrentOrg } from '../../../common/decorators';
import { ApiKeyThrottleGuard } from '../guards/api-key-throttle.guard';
import { HubOrderService } from '../../sales-reports/hub-order.service';
import { OrderLookupPublicDto, OrderWonPublicDto } from '../dto/orders.public.dto';

/**
 * Integração com o OFP Hub: consulta de card/vendedor por cliente e aviso de
 * pedido fechado. Tudo restrito à org da chave `pk_`.
 */
@ApiTags('Public API · Orders')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottleGuard)
@Controller('public/orders')
export class PublicOrdersController {
  constructor(private readonly hubOrders: HubOrderService) {}

  @Get('lookup')
  @ApiOperation({ summary: 'Card e vendedor do cliente (por e-mail ou telefone)' })
  lookup(@CurrentOrg('id') orgId: string, @Query() query: OrderLookupPublicDto) {
    return this.hubOrders.lookup(orgId, query);
  }

  @Post('won')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pedido fechado no Hub → liga ao card e marca Ganho (idempotente)' })
  won(@CurrentOrg('id') orgId: string, @Body() dto: OrderWonPublicDto) {
    return this.hubOrders.markWon(orgId, {
      externalId: dto.externalId,
      pedido: dto.pedido ?? null,
      cliente: dto.cliente ?? null,
      email: dto.email ?? null,
      telefone: dto.telefone ?? null,
      venda: dto.venda ?? null,
      data: dto.data,
      vendedor: dto.vendedor ?? null,
      fornecedor: dto.fornecedor ?? null,
    });
  }
}
