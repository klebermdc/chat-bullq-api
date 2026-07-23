import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { Roles, CurrentOrg } from '../../common/decorators';
import { SonaxSettingsService } from './sonax-settings.service';
import { UpsertSonaxSettingsDto } from './dto/upsert-sonax-settings.dto';

@ApiTags('Calls')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('organizations/settings/sonax')
export class SonaxSettingsController {
  constructor(
    private readonly service: SonaxSettingsService,
    private readonly config: ConfigService,
  ) {}

  private toPublic(s: any) {
    if (!s) return { enabled: false, idCliente: '', tokenConfigured: false, webhookUrl: null };
    // APP_URL = base pública da API SEM prefixo (ex.: https://api-ofpchat.explotek.pro);
    // o código anexa /api/v1 (mesmo contrato de uploads/media-library).
    const base = (this.config.get<string>('APP_URL') ?? '').replace(/\/$/, '');
    return {
      enabled: s.enabled,
      idCliente: s.idCliente,
      tokenConfigured: !!s.tokenEnc,
      click2callBaseUrl: s.click2callBaseUrl,
      // var_1=<VAR1>: <VAR1> devolve o valor que ENVIAMOS no click2call (call.id),
      // que é a chave de correlação. <ID_CHAMADA> é o id interno da Sonax (guardado
      // só pra referência em id_chamada). NÃO usar <ID_CHAMADA> no var_1.
      webhookUrl: `${base}/api/v1/webhooks/sonax/${s.webhookSecret}?var_1=<VAR1>&status=<STATUS_CHAMADA>&status_atend=<STATUS_ATENDIMENTO>&duracao=<DURACAO_CHAMADA>&url_gravacao=<URL_GRAVACAO>&id_chamada=<ID_CHAMADA>`,
    };
  }

  @Get()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Config Sonax da organização (nunca devolve o token em claro)' })
  async get(@CurrentOrg('id') orgId: string) {
    return this.toPublic(await this.service.get(orgId));
  }

  @Put()
  @Roles(OrgRole.OWNER, OrgRole.ADMIN)
  @ApiOperation({ summary: 'Salva a config Sonax da organização' })
  async put(@CurrentOrg('id') orgId: string, @Body() dto: UpsertSonaxSettingsDto) {
    return this.toPublic(await this.service.upsert(orgId, dto));
  }
}
