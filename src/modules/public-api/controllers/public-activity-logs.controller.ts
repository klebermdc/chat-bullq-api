import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../../../common/guards';
import { CurrentOrg } from '../../../common/decorators';
import { ApiKeyThrottleGuard } from '../guards/api-key-throttle.guard';
import { toPublicPage } from '../dto/public-page';
import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { mapActivityLog } from '../mappers/activity-log.mapper';
import { ListActivityLogsPublicDto } from '../dto/list-activity-logs.public.dto';

@ApiTags('Public API · Activity Logs')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottleGuard)
@Controller('public/activity-logs')
export class PublicActivityLogsController {
  constructor(private readonly service: ActivityLogsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista eventos de auditoria de conversas (paginado)' })
  async list(@CurrentOrg('id') orgId: string, @Query() q: ListActivityLogsPublicDto) {
    const filters = {
      conversationId: q.conversationId,
      actorId: q.actorId,
      action: q.action,
      from: q.from ? new Date(q.from) : undefined,
      to: q.to ? new Date(q.to) : undefined,
    };
    const { logs, total } = await this.service.list(orgId, filters, q.page, q.limit);
    return toPublicPage(logs.map(mapActivityLog), total, q.page, q.limit);
  }
}
