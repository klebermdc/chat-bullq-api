import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, Roles } from '../../common/decorators';
import { UpdateWebsiteLeadSettingsDto } from './dto/update-website-lead-settings.dto';
import { WebsiteLeadOriginService } from './website-lead-origin.service';
import { WebsiteLeadSettingsService } from './website-lead-settings.service';

@ApiTags('Leads do site')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('website-leads')
export class WebsiteLeadsController {
  constructor(
    private readonly settings: WebsiteLeadSettingsService,
    private readonly origin: WebsiteLeadOriginService,
  ) {}

  @Get('settings')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  getSettings(@CurrentOrg('id') orgId: string) {
    return this.settings.get(orgId);
  }

  @Put('settings')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  updateSettings(@CurrentOrg('id') orgId: string, @Body() dto: UpdateWebsiteLeadSettingsDto) {
    return this.settings.update(orgId, dto);
  }

  /** Gera ou troca o token. O antigo para de valer na hora. */
  @Post('settings/token')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  rotateToken(@CurrentOrg('id') orgId: string) {
    return this.settings.rotateToken(orgId);
  }

  @Get('contacts/:contactId/origin')
  contactOrigin(@CurrentOrg('id') orgId: string, @Param('contactId') contactId: string) {
    return this.origin.forContact(orgId, contactId);
  }
}
