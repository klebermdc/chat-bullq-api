import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, CurrentOrg, CurrentChannelAccess } from '../../common/decorators';
import type { ChannelAccess } from '../iam/channel-access/channel-access.service';
import { ScheduledMessagesService } from './scheduled-messages.service';
import { CreateScheduledMessageDto } from './dto/create-scheduled-message.dto';
import { UpdateScheduledMessageDto } from './dto/update-scheduled-message.dto';

@ApiTags('Scheduled Messages')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('scheduled-messages')
export class ScheduledMessagesController {
  constructor(private readonly service: ScheduledMessagesService) {}

  @Post()
  create(
    @Body() dto: CreateScheduledMessageDto,
    @CurrentUser('id') userId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
  ) {
    return this.service.create(dto, userId, orgId, access);
  }

  @Get('conversation/:conversationId')
  listByConversation(
    @Param('conversationId') conversationId: string,
    @CurrentOrg('id') orgId: string,
    @CurrentChannelAccess() access: ChannelAccess,
    @Query('status') status?: string,
  ) {
    return this.service.listForConversation(conversationId, orgId, access, status);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateScheduledMessageDto,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.service.reschedule(id, dto, orgId);
  }

  @Delete(':id')
  cancel(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.cancel(id, orgId, 'manual');
  }
}
