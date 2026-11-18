import { Body, Controller, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/decorators';
import { NfseApiKeyGuard } from './nfse-api-key.guard';
import { parseNfsePayload } from './nfse-payload';
import { NfseService } from './nfse.service';

/** O Hub manda uma nota por guiamento; 30 por minuto sobra e corta abuso. */
const LIMITE_NFSE = { ttl: 60_000, limit: 30 };

@ApiTags('NFS-e')
@Controller('nfse')
export class NfseController {
  constructor(private readonly nfse: NfseService) {}

  @Post('enviar')
  @Public()
  @UseGuards(NfseApiKeyGuard)
  @HttpCode(200)
  @Throttle({ geral: LIMITE_NFSE })
  @ApiOperation({ summary: 'OFP Hub: envia a NFS-e do guiamento ao cliente pelo WhatsApp (header x-api-key).' })
  async enviar(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const parsed = parseNfsePayload(body);
    if (!parsed.ok) {
      res.status(400);
      return { ok: false, erro: parsed.error };
    }
    const result = await this.nfse.enviar(parsed.value);
    res.status(result.status);
    return result.body;
  }
}
