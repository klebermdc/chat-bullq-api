import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import { StorageService } from '../storage/storage.service';
import { AcceptancesService } from './acceptances.service';
import { streamStoredPdf } from './stream-pdf.util';
import { SignAcceptanceDto } from './dto/sign-acceptance.dto';

@ApiTags('Acceptances (Public)')
@Controller('public/acceptances')
export class PublicAcceptancesController {
  constructor(
    private readonly service: AcceptancesService,
    private readonly storage: StorageService,
  ) {}

  /**
   * PDF do aceite para o CLIENTE, que não tem conta no sistema.
   *
   * O token (32 bytes aleatórios) já é o único fator de acesso à página
   * pública inteira — servir o comprovante por ele não afrouxa nada, e tira
   * o PDF da rota de uploads, que servia o bucket todo sem autenticação.
   */
  @Public()
  @Get(':token/pdf')
  async pdf(
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const key = await this.service.pdfKeyByToken(token);
    await streamStoredPdf(this.storage, key, res);
  }

  @Public()
  @Get(':token')
  get(@Param('token') token: string) {
    return this.service.getByToken(token);
  }

  @Public()
  @Post(':token/sign')
  sign(
    @Param('token') token: string,
    @Body() dto: SignAcceptanceDto,
    @Req() req: Request,
  ) {
    const ip =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      '';
    const userAgent = (req.headers['user-agent'] as string) || '';
    return this.service.sign(token, { name: dto.name.trim(), ip, userAgent });
  }
}
