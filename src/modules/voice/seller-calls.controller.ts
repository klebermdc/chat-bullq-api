import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { IsString, Length, Matches } from 'class-validator';
import { CurrentOrg, CurrentUser, CurrentUserRole } from '../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { SellerCallsService } from './seller-calls.service';

class ConversationDto {
  @IsString() @Length(1, 64) conversationId!: string;
}

class EndCallDto extends ConversationDto {
  @IsString() @Matches(/^vendedor-[A-Za-z0-9-]{1,120}$/) room!: string;
}

/** Vendedor liga para o cliente pelo WhatsApp (áudio no navegador). */
@ApiTags('Voice')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('voice/seller-calls')
export class SellerCallsController {
  constructor(private readonly service: SellerCallsService) {}

  @Post('check')
  @HttpCode(200)
  check(@CurrentOrg('id') orgId: string, @CurrentUser() user: { id: string; name?: string }, @CurrentUserRole() role: OrgRole | undefined, @Body() dto: ConversationDto) {
    return this.service.check(orgId, dto.conversationId, { userId: user.id, role, name: user.name ?? 'Vendedor' });
  }

  @Post('permission')
  @HttpCode(200)
  permission(@CurrentOrg('id') orgId: string, @CurrentUser() user: { id: string; name?: string }, @CurrentUserRole() role: OrgRole | undefined, @Body() dto: ConversationDto) {
    return this.service.requestPermission(orgId, dto.conversationId, { userId: user.id, role, name: user.name ?? 'Vendedor' });
  }

  @Post('start')
  @HttpCode(200)
  start(@CurrentOrg('id') orgId: string, @CurrentUser() user: { id: string; name?: string }, @CurrentUserRole() role: OrgRole | undefined, @Body() dto: ConversationDto) {
    return this.service.start(orgId, dto.conversationId, { userId: user.id, role, name: user.name ?? 'Vendedor' });
  }

  @Post('end')
  @HttpCode(200)
  end(@CurrentOrg('id') orgId: string, @CurrentUser() user: { id: string; name?: string }, @CurrentUserRole() role: OrgRole | undefined, @Body() dto: EndCallDto) {
    return this.service.end(orgId, dto.conversationId, dto.room, { userId: user.id, role, name: user.name ?? 'Vendedor' });
  }
}
