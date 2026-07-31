import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators';
import { HealthResult, HealthService } from './health.service';

/**
 * Alvo do monitor externo (UptimeRobot / BetterStack). Rota final, com o
 * prefixo global: GET /api/v1/health
 *
 * Usa `@Res({ passthrough: true })` em vez de lançar exceção de propósito: um
 * `ServiceUnavailableException` passaria pelo GlobalExceptionFilter e criaria
 * um issue novo a CADA batida do monitor enquanto o sistema estivesse
 * degradado — um laço de realimentação que encheria o painel e o Telegram.
 *
 * O corpo não expõe versão, env nem host: a rota é pública.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Health check profundo (Postgres + Redis)' })
  async check(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthResult> {
    const result = await this.health.check();
    res.status(
      result.status === 'ok'
        ? HttpStatus.OK
        : HttpStatus.SERVICE_UNAVAILABLE,
    );
    return result;
  }
}
