import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg } from '../../common/decorators';
import { AcceptancesService } from './acceptances.service';
import { ExtractVoucherDto } from './dto/extract-voucher.dto';

@ApiTags('Acceptances')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('acceptances')
export class AcceptancesController {
  constructor(private readonly service: AcceptancesService) {}

  @Get('conversation/:conversationId')
  status(
    @Param('conversationId') conversationId: string,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.service.getStatusForConversation(orgId, conversationId);
  }

  // Precisa vir ANTES de `@Post(':id/resend')`, senão o Nest casa
  // "extract-voucher" como um `:id`.
  @Post('extract-voucher')
  extractVoucher(
    @Body() dto: ExtractVoucherDto,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.service.extractVoucher(orgId, { mediaUrl: dto.mediaUrl });
  }

  @Post(':id/resend')
  resend(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.resend(orgId, id);
  }
}
