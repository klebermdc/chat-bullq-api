import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import {
  CurrentChannelAccess,
  CurrentOrg,
  CurrentUser,
  CurrentUserRole,
  Roles,
} from '../../common/decorators';
import type { ChannelAccess } from '../iam/channel-access/channel-access.service';
import { DocumentTemplatesService, TemplateActor } from './document-templates.service';
import {
  CreateDocumentTemplateDto,
  ListDocumentTemplatesQueryDto,
  UpdateDocumentTemplateDto,
} from './dto/document-template.dto';
import { AutofillQueryDto, FillTemplateDto } from './dto/fill-template.dto';
import { sendPdf } from './pdf-response.util';
import { Throttle } from '@nestjs/throttler';
import { LIMITE_PDF } from '../acceptances/acceptances.constants';
import { AiFillDto, UpdateFieldDefaultsDto } from './dto/contract-fill.dto';
import { FieldDefaultsService } from './field-defaults.service';
import { AiFillService } from './ai-fill.service';
import { LIMITE_IA } from './document-templates.constants';

/**
 * Modelos de documento. Leitura/preenchimento: qualquer membro (AGENT só vê
 * modelo de CLIENTE ativo — a regra fica no serviço). Criar/editar/desativar:
 * só OWNER/ADMIN.
 */
@ApiTags('Document templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('document-templates')
export class DocumentTemplatesController {
  constructor(
    private readonly service: DocumentTemplatesService,
    private readonly fieldDefaults: FieldDefaultsService,
    private readonly aiFill: AiFillService,
  ) {}

  private actor(organizationId: string, role: OrgRole, userId: string): TemplateActor {
    return { organizationId, role, userId };
  }

  @Get()
  @ApiOperation({ summary: 'Lista os modelos (AGENT: só de cliente e ativos)' })
  list(
    @Query() query: ListDocumentTemplatesQueryDto,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.list(this.actor(orgId, role, userId), query);
  }

  // Rotas fixas ANTES de `:id`: senão GET /field-defaults cairia no `get`.
  @Get('field-defaults')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Dados fixos da agência para os modelos + campos sugeridos' })
  getFieldDefaults(@CurrentOrg('id') orgId: string) {
    return this.fieldDefaults.get(orgId);
  }

  @Put('field-defaults')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Grava dados fixos da agência (valor vazio remove o campo)' })
  putFieldDefaults(@Body() dto: UpdateFieldDefaultsDto, @CurrentOrg('id') orgId: string) {
    return this.fieldDefaults.update(orgId, dto.values);
  }

  @Get(':id')
  get(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.get(this.actor(orgId, role, userId), id);
  }

  @Post()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  create(
    @Body() dto: CreateDocumentTemplateDto,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.create(this.actor(orgId, role, userId), dto);
  }

  @Patch(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateDocumentTemplateDto,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.update(this.actor(orgId, role, userId), id, dto);
  }

  @Delete(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Desativa o modelo (exclusão suave)' })
  remove(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.deactivate(this.actor(orgId, role, userId), id);
  }

  @Get(':id/autofill')
  @ApiOperation({ summary: 'Valores pré-preenchidos (agência, cliente da conversa, data)' })
  autofill(
    @Param('id') id: string,
    @Query() query: AutofillQueryDto,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() channelAccess: ChannelAccess,
  ) {
    return this.service.autofill({ organizationId: orgId, role, userId, channelAccess }, id, query.conversationId);
  }

  @Post(':id/ai-fill')
  @Throttle({ geral: LIMITE_IA })
  @ApiOperation({ summary: 'Preenche campos com IA a partir de texto colado e/ou da conversa' })
  fillWithAi(
    @Param('id') id: string,
    @Body() dto: AiFillDto,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() channelAccess: ChannelAccess,
  ) {
    return this.aiFill.fill({ organizationId: orgId, role, userId, channelAccess }, id, dto);
  }

  @Post(':id/render')
  render(
    @Param('id') id: string,
    @Body() dto: FillTemplateDto,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
  ) {
    return this.service.render(this.actor(orgId, role, userId), id, dto.values);
  }

  @Post(':id/pdf')
  @Throttle({ geral: LIMITE_PDF })
  @ApiOperation({ summary: 'PDF do texto preenchido (sem assinatura)' })
  async pdf(
    @Param('id') id: string,
    @Body() dto: FillTemplateDto,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, title } = await this.service.pdfFor(this.actor(orgId, role, userId), id, dto.values);
    sendPdf(res, buffer, title);
  }
}
