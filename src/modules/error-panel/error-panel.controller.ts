import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard, SuperAdminGuard } from '../../common/guards';
import { ListErrorsDto } from './dto/list-errors.dto';
import { UpdateErrorDto } from './dto/update-error.dto';
import { ErrorPanelService } from './error-panel.service';

/**
 * Painel de bugs — só superadmin da plataforma.
 *
 * O corte é aqui e só aqui: o serviço não filtra por organização, porque
 * erro de infraestrutura não pertence a org nenhuma e o stack dele pode
 * conter dado de qualquer cliente. Remover `SuperAdminGuard` desta classe
 * abriria stack trace de todas as orgs para qualquer usuário logado — por
 * isso existe um teste que falha se ele sumir.
 *
 * Rota sob `platform/` para ficar junto do resto da área de plataforma.
 */
@ApiTags('Platform')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('platform/errors')
export class ErrorPanelController {
  constructor(private readonly service: ErrorPanelService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os problemas coletados' })
  list(@Query() dto: ListErrorsDto) {
    return this.service.list(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe do problema com as ultimas ocorrencias' })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Resolver, silenciar ou reabrir' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateErrorDto) {
    return this.service.updateStatus(id, dto);
  }
}
