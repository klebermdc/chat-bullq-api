import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { OrgRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import {
  CurrentChannelAccess,
  CurrentOrg,
  CurrentUser,
  CurrentUserRole,
} from '../../common/decorators';
import type { ChannelAccess } from '../iam/channel-access/channel-access.service';
import { AcceptanceAccessService } from './acceptance-access.service';
import { ConversationActor } from './conversation-guard.service';
import { LIMITE_REENVIO } from './acceptances.constants';
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
    private readonly access: AcceptanceAccessService,
  ) {}

  private actor(
    organizationId: string,
    role: OrgRole,
    userId: string,
    channelAccess: ChannelAccess,
  ): ConversationActor {
    return { organizationId, role, userId, channelAccess };
  }

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
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() channels: ChannelAccess,
    @Res() res: Response,
  ): Promise<void> {
    // Além da org: a conversa do aceite (AGENT só a dele / canal liberado).
    await this.access.assertAccess(this.actor(orgId, role, userId, channels), id);
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
  @Throttle({ geral: LIMITE_REENVIO })
  async resend(
    @Param('id') id: string,
    @CurrentOrg('id') orgId: string,
    @CurrentUserRole() role: OrgRole,
    @CurrentUser('id') userId: string,
    @CurrentChannelAccess() channels: ChannelAccess,
  ) {
    await this.access.assertAccess(this.actor(orgId, role, userId, channels), id);
    return this.service.resend(orgId, id);
  }
}
