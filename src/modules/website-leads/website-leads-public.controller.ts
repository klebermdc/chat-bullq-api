import { Body, Controller, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators';
import { WebsiteLeadIntakeService } from './website-lead-intake.service';

/**
 * Por IP. O Elementor posta do servidor do WordPress (um IP só) e o site
 * recebe ~1.300 formulários por mês: 60 por minuto sobra para gente e corta
 * robô martelando a rota.
 */
const LIMITE_LEADS = { ttl: 60_000, limit: 60 };

@ApiTags('Leads do site')
@Controller('public/leads/website')
export class WebsiteLeadsPublicController {
  constructor(private readonly intake: WebsiteLeadIntakeService) {}

  @Post()
  @Public()
  @HttpCode(200)
  @Throttle({ geral: LIMITE_LEADS })
  @ApiOperation({
    summary: 'Recebe o formulário do site (Webhook do Elementor). Token em ?token= ou no header X-Lead-Token.',
  })
  receive(
    @Body() body: Record<string, unknown>,
    @Query('token') queryToken?: string,
    @Query('form') form?: string,
    @Headers('x-lead-token') headerToken?: string,
  ) {
    return this.intake.ingest({ token: headerToken || queryToken, body, formOverride: form });
  }

  @Post(':token')
  @Public()
  @HttpCode(200)
  @Throttle({ geral: LIMITE_LEADS })
  @ApiOperation({ summary: 'Mesmo que o POST acima, com o token no caminho.' })
  receiveWithPathToken(
    @Param('token') token: string,
    @Body() body: Record<string, unknown>,
    @Query('form') form?: string,
  ) {
    return this.intake.ingest({ token, body, formOverride: form });
  }
}
