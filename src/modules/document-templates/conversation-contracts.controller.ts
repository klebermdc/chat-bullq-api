import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import {
  CurrentChannelAccess,
  CurrentOrg,
  CurrentUser,
  CurrentUserRole,
} from '../../common/decorators';
import type { ChannelAccess } from '../iam/channel-access/channel-access.service';
import { ConversationContractsService, ContractActor } from './conversation-contracts.service';
import { CreateContractDto } from './dto/fill-template.dto';
import { DataRequestDto } from './dto/contract-fill.dto';
import { Throttle } from '@nestjs/throttler';
import { LIMITE_REENVIO } from '../acceptances/acceptances.constants';

/** Contratos de modelo enviados ao cliente de uma conversa. */
@ApiTags('Document templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('conversations/:conversationId/contracts')
export class ConversationContractsController {
  constructor(private readonly service: ConversationContractsService) {}

  private actor(
    organizationId: string,
    role: OrgRole,
    userId: string,
    channelAccess: ChannelAccess,
  ): ContractActor {
    return { organizationId, role, userId, channelAccess };
  }

  @Get()
  @ApiOperation({ summary: 'Contratos (CONTRACT) da conversa, do mais novo ao mais antigo' })
  list(
    @Param('conversationId') conversationId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.list(this.actor(orgId, role, userId, access), conversationId);
  }

  @Post()
  @ApiOperation({ summary: 'Gera o contrato do modelo e envia o link de aceite no WhatsApp' })
  create(
    @Param('conversationId') conversationId: string,
    @Body() dto: CreateContractDto,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.create(this.actor(orgId, role, userId, access), conversationId, dto);
  }

  @Post('data-request')
  @Throttle({ geral: LIMITE_REENVIO })
  @ApiOperation({ summary: 'Monta (e, com send, envia) o pedido dos dados que faltam do cliente' })
  requestData(
    @Param('conversationId') conversationId: string,
    @Body() dto: DataRequestDto,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.requestData(this.actor(orgId, role, userId, access), conversationId, dto);
  }

  @Post(':id/resend')
  @Throttle({ geral: LIMITE_REENVIO })
  @ApiOperation({ summary: 'Renova o prazo do contrato e reenvia o link no WhatsApp' })
  resend(
    @Param('conversationId') conversationId: string,
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.resend(this.actor(orgId, role, userId, access), conversationId, id);
  }
}
