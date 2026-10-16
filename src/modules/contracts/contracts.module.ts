import { Module } from '@nestjs/common';
import { chromium } from 'playwright';
import { ContractFilesService } from './contract-files.service';
import { ContractReportsService } from './contract-reports.service';
import { ContractSettingsService } from './contract-settings.service';
import { ContractsController } from './contracts.controller';
import { ContractsRepository } from './contracts.repository';
import { ContractsService } from './contracts.service';
import { ContractsImportController } from './legacy/contracts-import.controller';
import { ContractsImportService } from './legacy/contracts-import.service';
import { ContractPdfService } from './pdf/contract-pdf.service';

// PrismaModule, StorageModule e RealtimeModule são @Global(): PrismaService,
// StorageService e RealtimeGateway já são injetáveis sem importar os módulos.
@Module({
  controllers: [ContractsImportController, ContractsController],
  providers: [
    ContractsImportService,
    ContractsRepository,
    ContractsService,
    ContractFilesService,
    ContractSettingsService,
    ContractReportsService,
    { provide: ContractPdfService, useFactory: () => new ContractPdfService(chromium) },
  ],
  exports: [ContractsService, ContractFilesService, ContractSettingsService, ContractPdfService, ContractsRepository],
})
export class ContractsModule {}
