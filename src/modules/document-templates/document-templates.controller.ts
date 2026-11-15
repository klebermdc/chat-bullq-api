import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import type { Response } from 'express';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser, CurrentUserRole, Roles } from '../../common/decorators';
import { DocumentTemplatesService, TemplateActor } from './document-templates.service';
import {
  CreateDocumentTemplateDto,
  ListDocumentTemplatesQueryDto,
  UpdateDocumentTemplateDto,
} from './dto/document-template.dto';
import { AutofillQueryDto, FillTemplateDto } from './dto/fill-template.dto';
import { sendPdf } from './pdf-response.util';

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
  constructor(private readonly service: DocumentTemplatesService) {}

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
  ) {
    return this.service.autofill(this.actor(orgId, role, userId), id, query.conversationId);
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
