import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg } from '../../common/decorators';
import { StorageService } from '../storage/storage.service';
import { AcceptancesService } from './acceptances.service';
import { streamStoredPdf } from './stream-pdf.util';
import { ExtractVoucherDto } from './dto/extract-voucher.dto';
import { ExtractVoucherTextDto } from './dto/extract-voucher-text.dto';

@ApiTags('Acceptances')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('acceptances')
export class AcceptancesController {
  constructor(
    private readonly service: AcceptancesService,
    private readonly storage: StorageService,
  ) {}

  /**
   * PDF do aceite assinado para o operador.
   *
   * Antes ele saía por `/uploads/acceptances/<data>/<id>.pdf`, rota sem
   * autenticação: nome do cliente, assinatura e IP baixáveis por qualquer
   * pessoa com a URL, de qualquer organização.
   */
  @Get(':id/pdf')
  @ApiOperation({ summary: 'Baixa o PDF do aceite assinado (escopado por org)' })
  async pdf(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @Res() res: Response,
  ): Promise<void> {
    const key = await this.service.pdfKeyForOrg(id, orgId);
    await streamStoredPdf(this.storage, key, res);
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
