import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard } from '../../common/guards';
import { CurrentOrg, CurrentUser } from '../../common/decorators';
import { CallsService } from './calls.service';

@ApiTags('Calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard)
@Controller('conversations')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Post(':id/call')
  @ApiOperation({ summary: 'Inicia uma ligação click-to-call (Sonax) para o contato da conversa' })
  initiate(
    @Param('id') conversationId: string,
    @CurrentUser('id') userId: string,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.calls.initiateCall(conversationId, userId, orgId);
  }
}
