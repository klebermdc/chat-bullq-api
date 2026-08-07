import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { PipelinesService } from './pipelines.service';
import {
  CreateCardDto,
  CreatePipelineDto,
  MoveCardDto,
  UpdateCardDto,
  UpdatePipelineDto,
  UpsertStageDto,
} from './dto/pipeline.dto';
import { OrderSentDto } from '../acceptances/dto/create-acceptance.dto';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import {
  CurrentOrg,
  CurrentUser,
  CurrentUserRole,
  Feature,
} from '../../common/decorators';

@ApiTags('Pipelines (Kanban)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('pipelines')
export class PipelinesController {
  constructor(private readonly service: PipelinesService) {}

  @Get()
  @ApiOperation({ summary: 'List pipelines for current org' })
  list(
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.listPipelines(orgId, role, userId);
  }

  @Post()
  @Feature('pipelines.manage')
  @ApiOperation({ summary: 'Create a pipeline (with default stages if empty)' })
  create(
    @CurrentOrg('id') orgId: string,
    @Body() dto: CreatePipelineDto,
  ) {
    return this.service.createPipeline(orgId, dto);
  }

  @Get(':id/board')
  @ApiOperation({ summary: 'Get full kanban board (stages + cards by stage)' })
  board(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.getBoard(id, orgId, role, userId);
  }

  @Patch(':id')
  @Feature('pipelines.manage')
  @ApiOperation({ summary: 'Update pipeline metadata' })
  update(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Body() dto: UpdatePipelineDto,
  ) {
    return this.service.updatePipeline(id, orgId, dto);
  }

  @Delete(':id')
  @Feature('pipelines.manage')
  @ApiOperation({ summary: 'Delete pipeline (cascade stages + cards)' })
  remove(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.removePipeline(id, orgId);
  }

  @Put(':id/stages')
  @Feature('pipelines.manage')
  @ApiOperation({
    summary: 'Replace stages in bulk (upsert + delete orphans w/o cards)',
  })
  upsertStages(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Body() body: { stages: UpsertStageDto[] },
  ) {
    return this.service.upsertStages(id, orgId, body.stages ?? []);
  }

  // ─── Cards ────────────────────────────────────

  @Get('cards/by-conversation/:conversationId')
  @ApiOperation({
    summary:
      'List all cards (across pipelines) linked to a conversation. Used by the inbox header to show/edit/remove pipeline membership inline.',
  })
  cardsByConversation(
    @Param('conversationId') conversationId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.listCardsByConversation(
      conversationId,
      orgId,
      role,
      userId,
    );
  }

  @Post(':id/cards')
  @ApiOperation({ summary: 'Create a card in this pipeline' })
  createCard(
    @Param('id') pipelineId: string,
    @CurrentOrg('id') orgId: string,
    @Body() dto: CreateCardDto,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.createCard(pipelineId, orgId, dto, role, userId);
  }

  @Patch('cards/:cardId')
  @ApiOperation({ summary: 'Update card fields' })
  updateCard(
    @Param('cardId') cardId: string,
    @CurrentOrg('id') orgId: string,
    @Body() dto: UpdateCardDto,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.updateCard(cardId, orgId, dto, role, userId);
  }

  @Delete('cards/:cardId')
  @ApiOperation({ summary: 'Delete a card' })
  removeCard(
    @Param('cardId') cardId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.removeCard(cardId, orgId, role, userId);
  }

  @Post('cards/:cardId/move')
  @ApiOperation({
    summary:
      'Drag-drop a card to a stage at a specific index (0-based). Atomic.',
  })
  moveCard(
    @Param('cardId') cardId: string,
    @CurrentOrg('id') orgId: string,
    @Body() dto: MoveCardDto,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.moveCard(cardId, orgId, dto, role, userId);
  }

  @Post('conversations/:conversationId/order-sent')
  @ApiOperation({
    summary:
      'E6 — Entrega: move o card pra "Pedido enviado" e, se withAcceptance, gera o aceite e envia o link no WhatsApp.',
  })
  markOrderSent(
    @Param('conversationId') conversationId: string,
    @CurrentOrg('id') orgId: string,
    @Body() body: OrderSentDto,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.markOrderSentForConversation(
      orgId,
      conversationId,
      undefined,
      {
        withAcceptance: body?.withAcceptance,
        items: body?.items,
        termText: body?.termText,
        createdById: userId,
        vouchers: body?.vouchers,
        orderRef: body?.orderRef,
      },
      role,
      userId,
    );
  }

  @Post('conversations/:conversationId/won')
  @ApiOperation({
    summary:
      'E5.1 — Fechamento: marca Ganho (guarda o nº do pedido) e move o card pra etapa WON.',
  })
  markWon(
    @Param('conversationId') conversationId: string,
    @CurrentOrg('id') orgId: string,
    @Body() body: { orderNumber?: string },
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.markWonForConversation(
      orgId,
      conversationId,
      body?.orderNumber,
      role,
      userId,
    );
  }
}
