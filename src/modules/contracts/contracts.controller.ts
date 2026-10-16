import {
  BadRequestException, Body, Controller, Delete, Get, Param, ParseEnumPipe, Patch, Post, Put, Query, Res,
  UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { OrgRole } from '@prisma/client';
import type { Response } from 'express';
import { CurrentOrg, CurrentUser, CurrentUserRole, Roles } from '../../common/decorators';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../common/guards';
import type { ContractActor } from './contract-actor';
import { ContractFilesService, type ReadableFileKind } from './contract-files.service';
import { ContractReportsService } from './contract-reports.service';
import { ContractSettingsService } from './contract-settings.service';
import { CONTRACT_FILE_KINDS, MAX_FILE_BYTES, type ContractFileKind } from './contracts.constants';
import { toDetailView } from './contract-view';
import { ContractsService } from './contracts.service';
import { CreateContractDto, MoveDateDto, UpdateContractDto, UpdateFlagsDto } from './dto/contract.dto';
import { GuideQueryDto, ListContractsDto } from './dto/list-contracts.dto';
import { BlockedDateDto, UpdateContractSettingsDto } from './dto/settings.dto';

const READABLE_KINDS: readonly ReadableFileKind[] = [...CONTRACT_FILE_KINDS, 'signature', 'acceptance-pdf'];
const STAFF = [OrgRole.OWNER, OrgRole.ADMIN];
const MAX_GUIDE_LENGTH = 100;
/** Gerar PDF abre o Chromium: limite próprio, abaixo do geral. */
const PDF_THROTTLE = { geral: { ttl: 60_000, limit: 20 } };

const actorOf = (userId: string, role: OrgRole | undefined): ContractActor => ({ userId, role });

/** "Hoje" no fuso dos parques (lembrete de Multipass é às 7h de Orlando). */
const todayInOrlando = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());

/**
 * Toda rota com contrato recebe o ator (id + papel): AGENT só enxerga os
 * contratos que criou (escopo aplicado nos serviços). Rotas com @Roles(STAFF)
 * são só OWNER/ADMIN.
 */
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
  list(
    @CurrentOrg('id') org: string,
    @CurrentUser('id') user: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Query() q: ListContractsDto,
  ) {
    return this.contracts.list(org, actorOf(user, role), q);
  }

  @Get('stats')
  stats(
    @CurrentOrg('id') org: string,
    @CurrentUser('id') user: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Query() q: GuideQueryDto,
  ) {
    return this.contracts.stats(org, actorOf(user, role), q.guide);
  }

  @Get('billing')
  @Roles(...STAFF)
  billing(@CurrentOrg('id') org: string, @Query() q: ListContractsDto) {
    if (!q.year) throw new BadRequestException('Informe o ano');
    return this.reports.billing(org, { year: q.year, month: q.month, guide: q.guide, q: q.q });
  }

  @Get('calendar')
  calendar(
    @CurrentOrg('id') org: string,
    @CurrentUser('id') user: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Query() q: GuideQueryDto,
  ) {
    return this.reports.calendar(org, actorOf(user, role), q.guide);
  }

  @Get('multipass-reminders')
  reminders(
    @CurrentOrg('id') org: string,
    @CurrentUser('id') user: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Query() q: GuideQueryDto,
  ) {
    return this.reports.multipassReminders(org, actorOf(user, role), q.guide, todayInOrlando());
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
  blocked(@CurrentOrg('id') org: string, @Query() q: GuideQueryDto) {
    return this.settings.listBlockedDates(org, q.guide);
  }

  @Post('blocked-dates')
  @Roles(...STAFF)
  block(@CurrentOrg('id') org: string, @Body() dto: BlockedDateDto) {
    return this.settings.blockDate(org, dto);
  }

  @Delete('blocked-dates/:guide/:date')
  @Roles(...STAFF)
  unblock(@CurrentOrg('id') org: string, @Param('guide') guide: string, @Param('date') date: string) {
    const trimmed = guide.trim();
    if (!trimmed || trimmed.length > MAX_GUIDE_LENGTH) throw new BadRequestException('Guia inválido');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('Data inválida');
    return this.settings.unblockDate(org, trimmed, date);
  }

  @Post()
  create(@CurrentOrg('id') org: string, @CurrentUser('id') user: string, @Body() dto: CreateContractDto) {
    return this.contracts.create(org, user, dto);
  }

  @Get(':id')
  async get(
    @CurrentOrg('id') org: string,
    @CurrentUser('id') user: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Param('id') id: string,
  ) {
    const c = await this.contracts.get(org, actorOf(user, role), id);
    return { ...toDetailView(c), acceptLinkPath: c.acceptanceToken ? `/aceitar/${c.acceptanceToken}` : null };
  }

  @Patch(':id')
  update(
    @CurrentOrg('id') org: string,
    @CurrentUser('id') user: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateContractDto,
  ) {
    return this.contracts.update(org, actorOf(user, role), id, dto);
  }

  /** AGENT só pode mandar `purchased`; `paid`/`invoiceIssued` dão 403 (checado no serviço). */
  @Patch(':id/flags')
  flags(
    @CurrentOrg('id') org: string,
    @CurrentUser('id') user: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateFlagsDto,
  ) {
    return this.contracts.updateFlags(org, actorOf(user, role), id, dto);
  }

  @Patch(':id/dates')
  moveDate(
    @CurrentOrg('id') org: string,
    @CurrentUser('id') user: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Body() dto: MoveDateDto,
  ) {
    return this.contracts.moveDate(org, actorOf(user, role), id, dto);
  }

  @Post(':id/token')
  token(
    @CurrentOrg('id') org: string,
    @CurrentUser('id') user: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Param('id') id: string,
  ) {
    return this.contracts.regenerateToken(org, actorOf(user, role), id);
  }

  @Delete(':id')
  @Roles(...STAFF)
  remove(
    @CurrentOrg('id') org: string,
    @CurrentUser('id') user: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Param('id') id: string,
  ) {
    return this.contracts.remove(org, actorOf(user, role), id);
  }

  @Post(':id/files/:kind')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  async upload(
    @CurrentOrg('id') org: string,
    @CurrentUser('id') user: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Param('kind', new ParseEnumPipe(CONTRACT_FILE_KINDS)) kind: ContractFileKind,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined,
  ) {
    if (!file) throw new BadRequestException('Arquivo ausente (campo "file")');
    return { key: await this.files.upload(org, actorOf(user, role), id, kind, file) };
  }

  @Delete(':id/files/:kind')
  @Roles(...STAFF)
  clearFile(
    @CurrentOrg('id') org: string,
    @CurrentUser('id') user: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Param('kind', new ParseEnumPipe(CONTRACT_FILE_KINDS)) kind: ContractFileKind,
  ) {
    return this.files.clear(org, actorOf(user, role), id, kind);
  }

  @Get(':id/files/:kind')
  async file(
    @CurrentOrg('id') org: string,
    @CurrentUser('id') user: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Param('kind', new ParseEnumPipe(READABLE_KINDS)) kind: ReadableFileKind,
    @Res() res: Response,
  ) {
    const key = await this.files.keyFor(org, actorOf(user, role), id, kind);
    await this.files.stream(key, res, `${kind}${key.slice(key.lastIndexOf('.'))}`);
  }

  @Get(':id/pdf')
  @Throttle(PDF_THROTTLE)
  async pdf(
    @CurrentOrg('id') org: string,
    @CurrentUser('id') user: string,
    @CurrentUserRole() role: OrgRole | undefined,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const r = await this.contracts.pdfFor(org, actorOf(user, role), id);
    if ('key' in r) return this.files.stream(r.key, res, 'contrato.pdf');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    res.setHeader('Content-Disposition', 'inline; filename="contrato.pdf"');
    res.end(r.buffer);
  }
}
