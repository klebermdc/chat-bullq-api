import {
  BadRequestException,
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Roles } from '../../../common/decorators';
import { MessageTemplatesService } from './message-templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@ApiTags('message-templates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('channels/:channelId/message-templates')
export class MessageTemplatesController {
  constructor(private readonly service: MessageTemplatesService) {}

  @Get()
  list(
    @CurrentOrg('id') orgId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.service.list(orgId, channelId);
  }

  @Post()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  create(
    @CurrentOrg('id') orgId: string,
    @Param('channelId') channelId: string,
    @Body() dto: CreateTemplateDto,
  ) {
    return this.service.create(orgId, channelId, dto);
  }

  @Patch(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  update(
    @CurrentOrg('id') orgId: string,
    @Param('id') id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.service.update(orgId, id, dto);
  }

  @Post(':id/submit')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  submit(@CurrentOrg('id') orgId: string, @Param('id') id: string) {
    return this.service.submit(orgId, id);
  }

  @Post('upload-media')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @UseInterceptors(FileInterceptor('file'))
  uploadMedia(
    @CurrentOrg('id') orgId: string,
    @Param('channelId') channelId: string,
    @UploadedFile()
    file?: { buffer: Buffer; mimetype: string; originalname: string },
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.service.uploadHeaderMedia(orgId, channelId, {
      buffer: file.buffer,
      fileName: file.originalname,
      mimeType: file.mimetype,
    });
  }

  @Post('sync')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  sync(
    @CurrentOrg('id') orgId: string,
    @Param('channelId') channelId: string,
  ) {
    return this.service.sync(orgId, channelId);
  }

  @Delete(':id')
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  remove(@CurrentOrg('id') orgId: string, @Param('id') id: string) {
    return this.service.remove(orgId, id);
  }
}
