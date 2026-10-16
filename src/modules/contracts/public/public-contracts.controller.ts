import {
  BadRequestException, Body, Controller, Get, Param, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../../../common/decorators';
import { ContractFilesService, type IncomingFile } from '../contract-files.service';
import { ContractAcceptanceService } from './contract-acceptance.service';
import { checkContractToken as checkToken, ContractTokenGuard } from './contract-token.guard';
import { AcceptContractDto } from './dto/accept.dto';

const MINUTE_MS = 60_000;
const READ_LIMIT_PER_MINUTE = 30;
const WRITE_LIMIT_PER_MINUTE = 5;
/** Comprovante pelo link público: menor que os 10 MB do painel. */
export const PUBLIC_RECEIPT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Página de aceite do cliente (sem login). O token é o único fator de acesso
 * e só dá acesso àquele contrato: view enxuta, aceite, PDF e comprovante.
 */
@ApiTags('Contracts — público')
@Public()
@Throttle({ geral: { ttl: MINUTE_MS, limit: READ_LIMIT_PER_MINUTE } })
@Controller('public/contracts')
export class PublicContractsController {
  constructor(
    private readonly acceptance: ContractAcceptanceService,
    private readonly files: ContractFilesService,
  ) {}

  @Get(':token')
  view(@Param('token') token: string) {
    return this.acceptance.view(checkToken(token));
  }

  @Post(':token/accept')
  @Throttle({ geral: { ttl: MINUTE_MS, limit: WRITE_LIMIT_PER_MINUTE } })
  accept(@Param('token') token: string, @Body() dto: AcceptContractDto, @Req() req: Request) {
    // `trust proxy` = 1 (Caddy) no main.ts: req.ip é o IP real, não o x-forwarded-for cru.
    return this.acceptance.accept(checkToken(token), dto, {
      ip: req.ip ?? null,
      userAgent: req.get('user-agent') ?? null,
    });
  }

  @Get(':token/pdf')
  async pdf(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const r = await this.acceptance.pdfByToken(checkToken(token));
    if ('key' in r) {
      await this.files.stream(r.key, res, 'contrato.pdf');
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.setHeader('Content-Disposition', 'inline; filename="contrato.pdf"');
    res.end(r.buffer);
  }

  @Post(':token/receipt')
  @Throttle({ geral: { ttl: MINUTE_MS, limit: WRITE_LIMIT_PER_MINUTE } })
  // O guard confere o token no banco antes de o multer ler o arquivo.
  @UseGuards(ContractTokenGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: PUBLIC_RECEIPT_MAX_BYTES, files: 1 } }))
  receipt(@Param('token') token: string, @UploadedFile() file: IncomingFile | undefined) {
    const valid = checkToken(token);
    if (!file) throw new BadRequestException('Envie o comprovante (campo "file")');
    const appUrl = (process.env.APP_PUBLIC_URL || '').trim().replace(/\/+$/, '');
    return this.acceptance.uploadReceipt(valid, file, appUrl);
  }
}
