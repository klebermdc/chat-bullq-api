import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import { AcceptancesService } from './acceptances.service';
import { SignAcceptanceDto } from './dto/sign-acceptance.dto';

@ApiTags('Acceptances (Public)')
@Controller('public/acceptances')
export class PublicAcceptancesController {
  constructor(private readonly service: AcceptancesService) {}

  @Public()
  @Get(':token')
  get(@Param('token') token: string) {
    return this.service.getByToken(token);
  }

  /**
   * PDF assinado para o próprio cliente. Ele não tem login, mas tem o token —
   * o mesmo segredo que já abre a página do aceite. Sem esta rota, tirar o PDF
   * de `/uploads` deixaria o cliente sem acesso ao documento que ele assinou.
   */
  @Public()
  @Get(':token/pdf')
  async pdf(@Param('token') token: string, @Res() res: Response) {
    const { buffer, fileName } = await this.service.pdfForToken(token);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Content-Length': String(buffer.length),
    });
    res.end(buffer);
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
