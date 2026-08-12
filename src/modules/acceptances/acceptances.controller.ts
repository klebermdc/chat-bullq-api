import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg } from '../../common/decorators';
import { AcceptancesService } from './acceptances.service';
import { ExtractVoucherDto } from './dto/extract-voucher.dto';
import { ExtractVoucherTextDto } from './dto/extract-voucher-text.dto';

@ApiTags('Acceptances')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('acceptances')
export class AcceptancesController {
  constructor(private readonly service: AcceptancesService) {}

  /**
   * PDF assinado para o atendente, escopado à organização dele. Substitui o
   * link direto de `/uploads`, que servia o documento sem sessão nenhuma.
   */
  @Get(':id/pdf')
  async pdf(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Res() res: Response,
  ) {
    const { buffer, fileName } = await this.service.pdfForOrg(id, orgId);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
  }

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

  // Também ANTES de `@Post(':id/resend')`, pelo mesmo motivo do irmão acima.
  // Caminho paralelo ao `extract-voucher`, não substituto: o PDF continua
  // valendo e as duas leituras se complementam.
  @Post('extract-voucher-text')
  extractVoucherText(
    @Body() dto: ExtractVoucherTextDto,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.service.extractVoucherText(orgId, { text: dto.text });
  }

  @Post(':id/resend')
  resend(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.service.resend(orgId, id);
  }
}
