import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, CurrentUser, Feature } from '../../../common/decorators';
import { AdConnectionService } from './ad-connection.service';
import { CreateConnectionDto } from './dto/create-connection.dto';
import { ExchangeCodeDto } from './dto/exchange-code.dto';

@ApiTags('marketing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('marketing/connections')
export class AdConnectionController {
  constructor(private readonly service: AdConnectionService) {}

  @Get()
  @Feature('marketing.view')
  list(@CurrentOrg('id') orgId: string) {
    return this.service.list(orgId);
  }

  /** Passo 1: troca o code e devolve { handshakeId, accounts }. Nada e persistido. */
  @Post('meta/exchange')
  @Feature('marketing.manage')
  exchange(@Body() dto: ExchangeCodeDto) {
    return this.service.listAvailableAccounts(dto.accessToken);
  }

  /** Passo 2: consome o handshake e grava a conexao da conta escolhida. */
  @Post('meta')
  @Feature('marketing.manage')
  create(
    @CurrentOrg('id') orgId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateConnectionDto,
  ) {
    return this.service.createConnection(orgId, userId, dto);
  }

  @Post(':id/sync')
  @Feature('marketing.manage')
  sync(@CurrentOrg('id') orgId: string, @Param('id') id: string) {
    return this.service.triggerSync(orgId, id);
  }

  @Delete(':id')
  @Feature('marketing.manage')
  remove(@CurrentOrg('id') orgId: string, @Param('id') id: string) {
    return this.service.remove(orgId, id);
  }
}
