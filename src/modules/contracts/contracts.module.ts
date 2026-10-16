import { Module } from '@nestjs/common';
import { chromium } from 'playwright';
import { ResendClient } from '../email-core/resend.client';
import { ContractFilesService } from './contract-files.service';
import { ContractReportsService } from './contract-reports.service';
import { ContractSettingsService } from './contract-settings.service';
import { ContractsController } from './contracts.controller';
import { ContractsRepository } from './contracts.repository';
import { ContractsService } from './contracts.service';
import { ContractsImportController } from './legacy/contracts-import.controller';
import { ContractsImportService } from './legacy/contracts-import.service';
import { ContractNotifierService } from './notify/contract-notifier.service';
import { ContractPdfService } from './pdf/contract-pdf.service';
import { ContractAcceptanceService } from './public/contract-acceptance.service';
import { PublicContractsController } from './public/public-contracts.controller';

// PrismaModule, StorageModule e RealtimeModule são @Global(): PrismaService,
// StorageService e RealtimeGateway já são injetáveis sem importar os módulos.
//
// ResendClient é registrado aqui em vez de importar EmailCoreModule: aquele
// módulo o exporta, mas importá-lo puxaria NotificationsModule (fila BullMQ)
// e EmailAudienceModule → TagsModule (OutboxService) só para mandar um e-mail,
// e o teste de boot isolado deixa de compilar. Ele não tem estado e se constrói
// a partir do env, as mesmas variáveis que o EmailCoreModule já exige no boot.
@Module({
  controllers: [ContractsImportController, ContractsController, PublicContractsController],
  providers: [
    ContractsImportService,
    ContractsRepository,
    ContractsService,
    ContractFilesService,
    ContractSettingsService,
    ContractReportsService,
    ContractAcceptanceService,
    ContractNotifierService,
    ResendClient,
    { provide: ContractPdfService, useFactory: () => new ContractPdfService(chromium) },
  ],
  exports: [ContractsService, ContractFilesService, ContractSettingsService, ContractPdfService, ContractsRepository],
})
export class ContractsModule {}
