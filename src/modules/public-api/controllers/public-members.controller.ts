import { Controller, Get, Param, UseGuards, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../../../common/guards';
import { CurrentOrg } from '../../../common/decorators';
import { ApiKeyThrottleGuard } from '../guards/api-key-throttle.guard';
import { OrganizationsService } from '../../organizations/organizations.service';
import { mapMember } from '../mappers/member.mapper';

@ApiTags('Public API · Members')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottleGuard)
@Controller('public/members')
export class PublicMembersController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista membros da organização' })
  async list(@CurrentOrg('id') orgId: string) {
    const members = await this.organizations.getMembers(orgId);
    return { items: members.map(mapMember) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalha um membro (por membership id)' })
  async get(@CurrentOrg('id') orgId: string, @Param('id') id: string) {
    const members = await this.organizations.getMembers(orgId);
    const member = members.find((m: any) => m.id === id);
    if (!member) throw new NotFoundException('Member not found');
    return mapMember(member);
  }
}
