import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, CurrentOrg, CurrentChannelAccess } from '../../common/decorators';
import type { ChannelAccess } from '../iam/channel-access/channel-access.service';
import { ProposalsService } from './proposals.service';
import { CreateProposalDto } from './dto/create-proposal.dto';

@ApiTags('Proposals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly service: ProposalsService) {}

  @Post()
  create(
    @Body() dto: CreateProposalDto,
    @CurrentUser('id') userId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.create(dto, userId, orgId, access);
  }

  @Get('contact/:contactId')
  listForContact(
    @Param('contactId') contactId: string,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.service.listForContact(orgId, contactId);
  }

  @Get('conversation/:conversationId')
  listForConversation(
    @Param('conversationId') conversationId: string,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.service.listForConversation(orgId, conversationId);
  }
}
