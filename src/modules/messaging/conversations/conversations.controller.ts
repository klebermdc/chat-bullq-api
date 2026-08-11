import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Put,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { ConversationsService } from './conversations.service';
import { StartConversationService } from './start-conversation.service';
import { StartConversationDto } from './dto/start-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { TransferConversationDto } from './dto/transfer-conversation.dto';
import { SetOriginDto } from './dto/set-origin.dto';
import { LeadOriginService } from '../pipeline/lead-origin.service';
import { ConversationTranscriptService } from './conversation-transcript.service';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import {
  CurrentUser,
  CurrentOrg,
  CurrentChannelAccess,
  CurrentUserRole,
  Feature,
  Roles,
} from '../../../common/decorators';
import type { ChannelAccess } from '../../iam/channel-access/channel-access.service';

@ApiTags('Conversations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly service: ConversationsService,
    private readonly startConversation: StartConversationService,
    private readonly leadOrigin: LeadOriginService,
    private readonly transcript: ConversationTranscriptService,
  ) {}

  @Get(':id/transcript.pdf')
  @ApiOperation({
    summary:
      'Histórico do cliente em PDF (esta conversa e os atendimentos anteriores). ' +
      'Gerado sob demanda e devolvido na resposta — nada é gravado em disco.',
  })
  async downloadTranscript(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('name') userName: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentChannelAccess() access: ChannelAccess,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.transcript.render(
      id,
      orgId,
      userName || 'Atendimento',
      access,
      userId,
      role,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

  @Post('start')
  @ApiOperation({ summary: 'Inicia uma conversa proativa (Zappfy): resolve contato/canal e envia a 1a mensagem.' })
  start(
    @CurrentOrg() org: { id: string; userOrganizationId: string; userRole: OrgRole },
    @Body() dto: StartConversationDto,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.startConversation.start(org.id, dto, access, {
      userOrganizationId: org.userOrganizationId,
      role: org.userRole,
    });
  }

  @Get()
  @ApiOperation({ summary: 'List conversations (inbox)' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({
    name: 'tab',
    required: false,
    description:
      'Aba de atendimento: waiting (Esperando) | inbox (Caixa de entrada) | closed (Finalizados)',
  })
  @ApiQuery({ name: 'channelId', required: false })
  @ApiQuery({ name: 'assignedToId', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({
    name: 'archived',
    required: false,
    description: 'exclude (default) | only | any',
  })
  @ApiQuery({
    name: 'unread',
    required: false,
    description: 'When "true", returns only conversations with unread inbound messages for the current user',
  })
  @ApiQuery({
    name: 'groups',
    required: false,
    description:
      'include (default — todas) | exclude (esconde grupos) | only (apenas grupos)',
  })
  @ApiQuery({
    name: 'tagIds',
    required: false,
    description:
      'CSV de IDs de tags. OR — devolve conversas que tenham QUALQUER uma das tags (na conversa OU no contato).',
  })
  @ApiQuery({
    name: 'dateFrom',
    required: false,
    description: 'ISO date; filtra por última atividade (lastMessageAt) >=',
  })
  @ApiQuery({
    name: 'dateTo',
    required: false,
    description: 'ISO date; filtra por última atividade (lastMessageAt) <=',
  })
  findInbox(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentUserRole() role: OrgRole,
    @Query('status') status?: string,
    @Query('tab') tab?: string,
    @Query('channelId') channelId?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('archived') archived?: string,
    @Query('unread') unread?: string,
    @Query('stuck') stuck?: string,
    @Query('groups') groups?: string,
    @Query('tagIds') tagIds?: string,
    @Query('segmentId') segmentId?: string,
    @Query('hoppeId') hoppeId?: string,
    @Query('responsibleUserId') responsibleUserId?: string,
    @Query('projectStatus') projectStatus?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const archivedScope =
      archived === 'only' || archived === 'any' ? archived : 'exclude';
    // groups param maps to repository's existing `kind` filter:
    //   exclude → kind=INDIVIDUAL (esconde grupos)
    //   only    → kind=GROUP (apenas grupos)
    //   include / default → undefined (todas)
    const kind: 'INDIVIDUAL' | 'GROUP' | undefined =
      groups === 'exclude' ? 'INDIVIDUAL' : groups === 'only' ? 'GROUP' : undefined;
    const parsedTagIds = tagIds
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedTab =
      tab === 'waiting' || tab === 'inbox' || tab === 'closed' ? tab : undefined;
    return this.service.findInbox(
      orgId,
      {
        status,
        tab: parsedTab,
        channelId,
        assignedToId,
        search,
        archived: archivedScope,
        unreadOnly: unread === 'true' || unread === '1',
        stuckOnly: stuck === 'true' || stuck === '1',
        kind,
        tagIds: parsedTagIds?.length ? parsedTagIds : undefined,
        segmentId: segmentId || undefined,
        hoppeId: hoppeId || undefined,
        responsibleUserId: responsibleUserId || undefined,
        projectStatus: projectStatus || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      },
      parseInt(page || '1', 10),
      parseInt(limit || '20', 10),
      access,
      userId,
      role,
    );
  }

  @Post(':id/archive')
  @ApiOperation({ summary: 'Archive a conversation' })
  archive(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.setArchived(id, orgId, true, userId, access);
  }

  @Post(':id/unarchive')
  @ApiOperation({ summary: 'Unarchive a conversation' })
  unarchive(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.setArchived(id, orgId, false, userId, access);
  }

  @Post(':id/waiting')
  @ApiOperation({
    summary:
      'Colocar no "Esperando" — marca a conversa como aguardando resposta humana (awaitingHumanReply=true).',
  })
  markWaiting(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.setWaiting(id, orgId, true, userId, access);
  }

  @Post(':id/unwaiting')
  @ApiOperation({
    summary:
      'Retirar do "Esperando" — remove a marca de aguardando resposta humana (awaitingHumanReply=false).',
  })
  unmarkWaiting(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.setWaiting(id, orgId, false, userId, access);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark conversation as read for current user' })
  markAsRead(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Body() body?: { lastReadMessageId?: string },
  ) {
    return this.service.markAsRead(
      id,
      orgId,
      userId,
      access,
      body?.lastReadMessageId,
    );
  }

  @Post(':id/unread')
  @ApiOperation({ summary: 'Mark conversation as unread for current user' })
  markAsUnread(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.markAsUnread(id, orgId, userId, access);
  }

  @Get('counts')
  @ApiOperation({ summary: 'Get conversation counts by status' })
  getCounts(
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.getStatusCounts(orgId, access, userId, role);
  }

  @Get('tab-counts')
  @ApiOperation({
    summary: 'Contagem das abas de atendimento (Esperando/Caixa de entrada/Finalizados)',
  })
  @ApiQuery({ name: 'channelId', required: false })
  getTabCounts(
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('channelId') channelId?: string,
  ) {
    return this.service.getTabCounts(orgId, access, userId, role, channelId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get conversation details' })
  findOne(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.findOne(id, orgId, access, userId, role);
  }

  @Get(':id/ai-summary')
  @ApiOperation({ summary: 'Resumo IA da conversa (Painel Inteligente) — gera+cacheia' })
  @ApiQuery({ name: 'refresh', required: false, description: '1 força regenerar' })
  aiSummary(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole,
    @Query('refresh') refresh?: string,
  ) {
    return this.service.getAiSummary(id, orgId, access, userId, role, {
      refresh: refresh === '1' || refresh === 'true',
    });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update conversation (assign, change status, department)' })
  update(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Body() dto: UpdateConversationDto,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.update(id, orgId, dto, userId, access, role);
  }

  @Post(':id/assign-me')
  @ApiOperation({ summary: 'Assign conversation to current user' })
  assignToMe(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.assignToMe(id, orgId, userId, access, role);
  }

  @Post(':id/transfer')
  @ApiOperation({
    summary:
      'Transfere o cliente para outro atendente (registra mensagem SYSTEM no thread).',
  })
  transfer(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Body() dto: TransferConversationDto,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.transfer(id, orgId, dto.toUserId, userId, dto.reason, access, role);
  }

  @Put(':id/origin')
  @ApiOperation({
    summary:
      'Define a origem do lead (correção manual, ex: card antigo marcado como Instagram Orgânico). Single-valued: substitui a tag de origem atual.',
  })
  setOrigin(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Body() dto: SetOriginDto,
  ) {
    return this.leadOrigin.setOrigin(orgId, id, dto.origin);
  }

  @Patch(':id/ai')
  @Feature('inbox.ai.toggle')
  @ApiOperation({
    summary:
      'Override AI behavior on this conversation. enabled=true forces AI on (overrides kill switch and business hours), false forces off, null clears the override (follows global rules).',
  })
  toggleAi(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Body() body: { enabled: boolean | null },
    @CurrentUserRole() role: OrgRole,
  ) {
    const value =
      body?.enabled === null || body?.enabled === undefined
        ? null
        : !!body.enabled;
    return this.service.toggleAi(id, orgId, value, userId, access, role);
  }

  @Post(':id/ai/engage')
  @Feature('inbox.ai.toggle')
  @ApiOperation({
    summary:
      'Manually engage the AI on this conversation right now. The agent reads the full message history, decides what to do (reply, delegate, transfer) and acts. Useful when the inbound stream is silent but a human wants the AI to take over (e.g. after pausing then resuming).',
  })
  engageAi(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.engageAi(id, orgId, userId, access, role);
  }

  @Post(':id/ai/set-agent')
  @Feature('inbox.ai.toggle')
  @ApiOperation({
    summary:
      'Pin a specific AI agent to this conversation and immediately engage it. Sets activeAgentId + aiEnabled=true + fires the runner. Use case: human picks Lívia/André via UI when delegating manually.',
  })
  setActiveAgent(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Body() body: { agentId: string },
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.setActiveAgent(
      id,
      orgId,
      body.agentId,
      userId,
      access,
      role,
    );
  }

  @Post(':id/close')
  @ApiOperation({ summary: 'Close a conversation' })
  close(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.close(id, orgId, userId, access, role);
  }

  @Post(':id/reopen')
  @ApiOperation({ summary: 'Reopen a closed conversation' })
  reopen(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @CurrentUserRole() role: OrgRole,
  ) {
    return this.service.reopen(id, orgId, userId, access, role);
  }

  @Post(':id/sync')
  @ApiOperation({
    summary:
      'Force-sync the latest messages for a conversation from the channel provider',
  })
  syncMessages(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.syncMessages(id, orgId, access);
  }

  @Delete(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({
    summary:
      'HARD-delete a conversation: cascades to messages, attachments, tags, AI runs, reads. Irreversible — requires ?confirm=<exact contact name or phone>.',
  })
  @ApiQuery({
    name: 'confirm',
    required: true,
    description:
      'Type the contact name or phone exactly to authorize the destructive action.',
  })
  remove(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Query('confirm') confirm: string,
  ) {
    return this.service.hardDelete(id, orgId, access, confirm);
  }
}
