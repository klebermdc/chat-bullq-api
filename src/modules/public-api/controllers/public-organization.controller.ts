import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../../../common/guards';
import { CurrentOrg } from '../../../common/decorators';
import { ApiKeyThrottleGuard } from '../guards/api-key-throttle.guard';
import { OrganizationsService } from '../../organizations/organizations.service';
import { mapOrganization } from '../mappers/organization.mapper';

@ApiTags('Public API · Organization')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottleGuard)
@Controller('public/organization')
export class PublicOrganizationController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'Dados da organização da API-key' })
  async get(@CurrentOrg('id') orgId: string) {
    return mapOrganization(await this.organizations.getOrganization(orgId));
  }
}
