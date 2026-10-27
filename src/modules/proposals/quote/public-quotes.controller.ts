import { Controller, Get, HttpCode, HttpStatus, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../../common/decorators';
import { checkQuoteToken, PublicQuotesService } from './public-quotes.service';

const MINUTE_MS = 60_000;
const READ_LIMIT_PER_MINUTE = 30;
const VIEW_LIMIT_PER_MINUTE = 10;
const PDF_LIMIT_PER_MINUTE = 10;

/**
 * Página da cotação por link (sem login): dados da cotação, registro de
 * abertura e PDF. Mesmo desenho do link público de contrato.
 */
@ApiTags('Cotações — público')
@Public()
@Throttle({ geral: { ttl: MINUTE_MS, limit: READ_LIMIT_PER_MINUTE } })
@Controller('public/quotes')
export class PublicQuotesController {
  constructor(private readonly quotes: PublicQuotesService) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.quotes.view(checkQuoteToken(token));
  }

  /** Chamado pelo navegador do cliente ao abrir a página (não pelo render no servidor). */
  @Post(':token/view')
  @HttpCode(HttpStatus.OK)
  @Throttle({ geral: { ttl: MINUTE_MS, limit: VIEW_LIMIT_PER_MINUTE } })
  markViewed(@Param('token') token: string) {
    return this.quotes.markViewed(checkQuoteToken(token));
  }

  @Get(':token/pdf')
  @Throttle({ geral: { ttl: MINUTE_MS, limit: PDF_LIMIT_PER_MINUTE } })
  async pdf(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const { buffer, filename } = await this.quotes.pdf(checkQuoteToken(token));
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.end(buffer);
  }
}
