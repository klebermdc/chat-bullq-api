import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../../../common/guards';
import { CurrentOrg, CurrentUser, CurrentUserRole } from '../../../common/decorators';
import { ApiKeyThrottleGuard } from '../guards/api-key-throttle.guard';
import { MessagesService } from '../../messaging/messages/messages.service';
import { mapMessage } from '../mappers/message.mapper';
import { SendMessagePublicDto } from '../dto/send-message.public.dto';
import { OrgRole } from '@prisma/client';

@ApiTags('Public API · Messages')
@ApiSecurity('api-key')
@UseGuards(ApiKeyAuthGuard, ApiKeyThrottleGuard)
@Controller('public/messages')
export class PublicMessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post()
  @ApiOperation({ summary: 'Envia uma mensagem numa conversa existente' })
  async send(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SendMessagePublicDto,
    @CurrentUserRole() role: OrgRole,
  ) {
    const sent = await this.messages.send(dto as any, userId, orgId, 'ALL', role);
    return mapMessage(sent);
  }
}
