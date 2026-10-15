import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OrgRole } from '@prisma/client';
import { JwtAuthGuard, OrgGuard, RolesGuard } from '../../../common/guards';
import { CurrentOrg, Roles } from '../../../common/decorators';
import { ContractsImportService } from './contracts-import.service';
import {
  ImportBlockedDatesDto,
  ImportContractsDto,
  ImportFileDto,
  ImportSettingsDto,
} from './dto/import-batch.dto';

const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Importação única (e repetível na virada) do app de contratos do Lovable. Só o dono. */
@ApiTags('Contracts — legacy import')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
@Roles(OrgRole.OWNER)
@Controller('contracts/legacy-import')
export class ContractsImportController {
  constructor(private readonly service: ContractsImportService) {}

  @Post('contracts')
  @ApiOperation({ summary: 'Upsert de um lote de contratos do Lovable' })
  contracts(@CurrentOrg('id') orgId: string, @Body() dto: ImportContractsDto) {
    return this.service.importContracts(orgId, dto.rows);
  }

  @Post('blocked-dates')
  @ApiOperation({ summary: 'Upsert de datas bloqueadas do Lovable' })
  blockedDates(@CurrentOrg('id') orgId: string, @Body() dto: ImportBlockedDatesDto) {
    return this.service.importBlockedDates(orgId, dto.rows);
  }

  @Post('settings')
  @ApiOperation({ summary: 'Grava os termos do contrato' })
  settings(@CurrentOrg('id') orgId: string, @Body() dto: ImportSettingsDto) {
    return this.service.importSettings(orgId, dto.terms);
  }

  @Post('files')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  @ApiOperation({ summary: 'Sobe um arquivo do bucket contract-documents' })
  file(
    @CurrentOrg('id') orgId: string,
    @Body() dto: ImportFileDto,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ) {
    if (!file) throw new BadRequestException('Arquivo ausente (campo "file")');
    return this.service.importFile(orgId, dto.path, file.buffer);
  }

  @Get('status')
  @ApiOperation({ summary: 'Contagens para conferir a importação' })
  status(@CurrentOrg('id') orgId: string) {
    return this.service.status(orgId);
  }
}
