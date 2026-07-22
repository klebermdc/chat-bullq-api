import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser, CurrentUserRole } from '../../common/decorators';
import { CallsService } from './calls.service';

@ApiTags('Calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('conversations')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Post(':id/call')
  @ApiOperation({ summary: 'Inicia uma ligação click-to-call (Sonax) para o contato da conversa' })
  initiate(
    @Param('id') conversationId: string,
    @CurrentUser('id') userId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.calls.initiateCall(conversationId, userId, orgId, role);
  }

  @Get(':id/calls/latest-insight')
  @ApiOperation({ summary: 'Resumo da última ligação atendida da conversa (transcrição+IA)' })
  latestInsight(
    @Param('id') conversationId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.calls.getLatestInsight(conversationId, orgId, role, userId);
  }

  @Get(':id/calls/:callId/transcript')
  @ApiOperation({ summary: 'Transcrição completa de uma ligação' })
  transcript(
    @Param('id') conversationId: string,
    @Param('callId') callId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.calls.getTranscript(conversationId, callId, orgId, role, userId);
  }
}
