import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { AiProviderKeysService } from './ai-provider-keys.service';
import { CreateAiProviderKeyDto } from './dto/create-ai-provider-key.dto';
import { UpdateAiProviderKeyDto } from './dto/update-ai-provider-key.dto';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, Roles } from '../../common/decorators';

@ApiTags('AI Provider Keys')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('ai-provider-keys')
export class AiProviderKeysController {
  constructor(private readonly service: AiProviderKeysService) {}

  @Get()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'List all AI provider keys of the current organization (no raw key)' })
  list(@CurrentOrg('id') organizationId: string) {
    return this.service.findAll(organizationId);
  }

  @Post()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Create a new AI provider key' })
  create(@Body() dto: CreateAiProviderKeyDto, @CurrentOrg('id') organizationId: string) {
    return this.service.create(organizationId, dto);
  }

  @Patch(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Update an AI provider key' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAiProviderKeyDto,
    @CurrentOrg('id') organizationId: string,
  ) {
    return this.service.update(organizationId, id, dto);
  }

  @Delete(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Delete an AI provider key' })
  remove(@Param('id') id: string, @CurrentOrg('id') organizationId: string) {
    return this.service.remove(organizationId, id);
  }
}
