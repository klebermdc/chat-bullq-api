import { Controller, Get, Post, Delete, Body, Query, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { EmailSubscriberStatus } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { CurrentOrg, Feature } from '../../common/decorators';
import { SubscribersService } from './subscribers.service';
import { SubscriberImportService } from './subscriber-import.service';
import { ImportCsvDto } from './dto/import-csv.dto';
import { TagSubscriberDto } from './dto/tag-subscriber.dto';

@ApiTags('Email · Destinatários')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Feature('email.view')
@Controller('email/subscribers')
export class SubscribersController {
  constructor(
    private readonly subscribers: SubscribersService,
    private readonly importer: SubscriberImportService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista destinatários (paginado)' })
  async list(
    @CurrentOrg('id') orgId: string,
    @Query('status') status?: EmailSubscriberStatus,
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    const p = Number(page) || 1;
    const l = Math.min(Number(limit) || 50, 200);
    const [items, total] = await this.subscribers.list(orgId, status, p, l);
    return { items, total, page: p, limit: l };
  }

  @Post('import/contacts')
  @ApiOperation({ summary: 'Importa os contatos do CRM que têm email' })
  importContacts(@CurrentOrg('id') orgId: string) {
    return this.importer.fromContacts(orgId);
  }

  @Post('import/sales-orders')
  @ApiOperation({ summary: 'Importa os emails dos pedidos do HUB' })
  importOrders(@CurrentOrg('id') orgId: string) {
    return this.importer.fromSalesOrders(orgId);
  }

  @Post('import/csv')
  @ApiOperation({ summary: 'Importa um CSV (email[,;]nome por linha)' })
  importCsv(@CurrentOrg('id') orgId: string, @Body() dto: ImportCsvDto) {
    return this.importer.fromCsv(orgId, dto.csv);
  }

  @Post(':id/unsubscribe')
  @ApiOperation({ summary: 'Descadastra manualmente' })
  unsubscribe(@Param('id') id: string, @CurrentOrg('id') orgId: string) {
    return this.subscribers.unsubscribe(id, orgId, 'descadastro manual pelo operador');
  }

  @Post(':id/tags')
  @ApiOperation({ summary: 'Aplica uma etiqueta ao destinatário' })
  addTag(@Param('id') id: string, @CurrentOrg('id') orgId: string, @Body() dto: TagSubscriberDto) {
    return this.subscribers.addTag(id, orgId, dto.tagId);
  }

  @Delete(':id/tags/:tagId')
  @ApiOperation({ summary: 'Remove uma etiqueta do destinatário' })
  removeTag(
    @Param('id') id: string,
    @Param('tagId') tagId: string,
    @CurrentOrg('id') orgId: string,
  ) {
    return this.subscribers.removeTag(id, orgId, tagId);
  }
}
