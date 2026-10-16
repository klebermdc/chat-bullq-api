import {
  BadRequestException, Body, Controller, Delete, Get, Param, ParseEnumPipe, Patch, Post, Put, Query, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentOrg, CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import { ContractFilesService, type ReadableFileKind } from './contract-files.service';
import { ContractReportsService } from './contract-reports.service';
import { ContractSettingsService } from './contract-settings.service';
import { CONTRACT_FILE_KINDS, MAX_FILE_BYTES, type ContractFileKind } from './contracts.constants';
import { ContractsService } from './contracts.service';
import { CreateContractDto, MoveDateDto, UpdateContractDto, UpdateFlagsDto } from './dto/contract.dto';
import { ListContractsDto } from './dto/list-contracts.dto';
import { BlockedDateDto, UpdateContractSettingsDto } from './dto/settings.dto';

const READABLE_KINDS: readonly ReadableFileKind[] = [...CONTRACT_FILE_KINDS, 'signature', 'acceptance-pdf'];
const STAFF = [OrgRole.OWNER, OrgRole.ADMIN];

/** "Hoje" no fuso dos parques (lembrete de Multipass é às 7h de Orlando). */
const todayInOrlando = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

@ApiTags('Contracts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Controller('contracts')
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly files: ContractFilesService,
    private readonly settings: ContractSettingsService,
    private readonly reports: ContractReportsService,
  ) {}

  @Get()
  list(@CurrentOrg('id') org: string, @Query() q: ListContractsDto) {
    return this.contracts.list(org, q);
  }

  @Get('stats')
  stats(@CurrentOrg('id') org: string, @Query('guide') guide?: string) {
    return this.contracts.stats(org, guide);
  }

  @Get('billing')
  billing(@CurrentOrg('id') org: string, @Query() q: ListContractsDto) {
    if (!q.year) throw new BadRequestException('Informe o ano');
    return this.reports.billing(org, { year: q.year, month: q.month, guide: q.guide, q: q.q });
  }

  @Get('calendar')
  calendar(@CurrentOrg('id') org: string, @Query('guide') guide?: string) {
    return this.reports.calendar(org, guide);
  }

  @Get('multipass-reminders')
  reminders(@CurrentOrg('id') org: string, @Query('guide') guide?: string) {
    return this.reports.multipassReminders(org, guide, todayInOrlando());
  }

  @Get('settings')
  getSettings(@CurrentOrg('id') org: string) {
    return this.settings.get(org);
  }

  @Put('settings')
  @Roles(...STAFF)
  putSettings(@CurrentOrg('id') org: string, @Body() dto: UpdateContractSettingsDto) {
    return this.settings.update(org, dto);
  }

  @Get('blocked-dates')
  blocked(@CurrentOrg('id') org: string, @Query('guide') guide?: string) {
    return this.settings.listBlockedDates(org, guide);
  }

  @Post('blocked-dates')
  block(@CurrentOrg('id') org: string, @Body() dto: BlockedDateDto) {
    return this.settings.blockDate(org, dto);
  }

  @Delete('blocked-dates/:guide/:date')
  unblock(@CurrentOrg('id') org: string, @Param('guide') guide: string, @Param('date') date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Data inválida');
    return this.settings.unblockDate(org, guide, date);
  }

  @Post()
  create(@CurrentOrg('id') org: string, @CurrentUser('id') user: string, @Body() dto: CreateContractDto) {
    return this.contracts.create(org, user, dto);
  }

  @Get(':id')
  async get(@CurrentOrg('id') org: string, @Param('id') id: string) {
    const c = await this.contracts.get(org, id);
    return { ...c, acceptLinkPath: c.acceptanceToken ? `/aceitar/${c.acceptanceToken}` : null };
  }

  @Patch(':id')
  update(@CurrentOrg('id') org: string, @Param('id') id: string, @Body() dto: UpdateContractDto) {
    return this.contracts.update(org, id, dto);
  }

  @Patch(':id/flags')
  flags(@CurrentOrg('id') org: string, @Param('id') id: string, @Body() dto: UpdateFlagsDto) {
    return this.contracts.updateFlags(org, id, dto);
  }

  @Patch(':id/dates')
  moveDate(@CurrentOrg('id') org: string, @Param('id') id: string, @Body() dto: MoveDateDto) {
    return this.contracts.moveDate(org, id, dto);
  }

  @Post(':id/token')
  token(@CurrentOrg('id') org: string, @Param('id') id: string) {
    return this.contracts.regenerateToken(org, id);
  }

  @Delete(':id')
  @Roles(...STAFF)
  remove(@CurrentOrg('id') org: string, @Param('id') id: string) {
    return this.contracts.remove(org, id);
  }

  @Post(':id/files/:kind')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  async upload(
    @CurrentOrg('id') org: string,
    @Param('id') id: string,
    @Param('kind', new ParseEnumPipe(CONTRACT_FILE_KINDS)) kind: ContractFileKind,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined,
  ) {
    if (!file) throw new BadRequestException('Arquivo ausente (campo "file")');
    return { key: await this.files.upload(org, id, kind, file) };
  }

  @Delete(':id/files/:kind')
  clearFile(
    @CurrentOrg('id') org: string,
    @Param('id') id: string,
    @Param('kind', new ParseEnumPipe(CONTRACT_FILE_KINDS)) kind: ContractFileKind,
  ) {
    return this.files.clear(org, id, kind);
  }

  @Get(':id/files/:kind')
  async file(
    @CurrentOrg('id') org: string,
    @Param('id') id: string,
    @Param('kind', new ParseEnumPipe(READABLE_KINDS)) kind: ReadableFileKind,
    @Res() res: Response,
  ) {
    const key = await this.files.keyFor(org, id, kind);
    await this.files.stream(key, res, `${kind}${key.slice(key.lastIndexOf('.'))}`);
  }

  @Get(':id/pdf')
  async pdf(@CurrentOrg('id') org: string, @Param('id') id: string, @Res() res: Response) {
    const r = await this.contracts.pdfFor(org, id);
    if ('key' in r) return this.files.stream(r.key, res, 'contrato.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.setHeader('Content-Disposition', 'inline; filename="contrato.pdf"');
    res.end(r.buffer);
  }
}
