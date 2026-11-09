import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { QuickRepliesService } from './quick-replies.service';
import { CreateQuickReplyDto } from './dto/create-quick-reply.dto';
import { UpdateQuickReplyDto } from './dto/update-quick-reply.dto';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser, CurrentUserRole } from '../../common/decorators';

@ApiTags('Quick replies')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('quick-replies')
export class QuickRepliesController {
  constructor(private readonly service: QuickRepliesService) {}

  /** Qualquer membro cria; atendente cria só para si (regra no service). */
  @Post()
  @ApiOperation({ summary: 'Create quick reply' })
  create(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Body() dto: CreateQuickReplyDto,
  ) {
    return this.service.create(orgId, dto, { userId, role });
  }

  @Get()
  @ApiOperation({ summary: 'List quick replies' })
  findAll(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole | undefined,
  ) {
    return this.service.findAll(orgId, { userId, role });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get quick reply by id' })
  findOne(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole | undefined,
  ) {
    return this.service.findOneVisible(id, orgId, { userId, role });
  }

  /** Atendente só mexe na própria (regra no service). */
  @Patch(':id')
  @ApiOperation({ summary: 'Update quick reply' })
  update(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Body() dto: UpdateQuickReplyDto,
  ) {
    return this.service.update(id, orgId, dto, { userId, role });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete quick reply' })
  remove(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @CurrentUserRole() role: OrgRole | undefined,
  ) {
    return this.service.remove(id, orgId, { userId, role });
  }
}
