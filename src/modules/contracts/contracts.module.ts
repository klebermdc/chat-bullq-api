import { Module } from '@nestjs/common';
import { chromium } from 'playwright';
import { LlmModule } from '../ai-agents/llm/llm.module';
import { ResendClient } from '../email-core/resend.client';
import { ContractParserService } from './ai/contract-parser.service';
import { ContractCalendarService } from './calendar/contract-calendar.service';
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
import { PlanejadorClient } from './planejador/planejador.client';
import { PlanejadorService } from './planejador/planejador.service';
import { ContractAcceptanceService } from './public/contract-acceptance.service';
import { PublicContractsController } from './public/public-contracts.controller';

// PrismaModule, StorageModule, RealtimeModule e CryptoModule são @Global():
// PrismaService, StorageService, RealtimeGateway e CryptoService já são
// injetáveis sem importar os módulos. LlmModule traz o LlmService do parser.
//
// ResendClient é registrado aqui em vez de importar EmailCoreModule: aquele
// módulo o exporta, mas importá-lo puxaria NotificationsModule (fila BullMQ)
// e EmailAudienceModule → TagsModule (OutboxService) só para mandar um e-mail,
// e o teste de boot isolado deixa de compilar. Ele não tem estado e se constrói
// a partir do env, as mesmas variáveis que o EmailCoreModule já exige no boot.
@Module({
  imports: [LlmModule],
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
    ContractParserService,
    PlanejadorService,
    { provide: PlanejadorClient, useFactory: () => new PlanejadorClient() },
    ContractCalendarService,
  ],
  exports: [
    ContractsService,
    ContractFilesService,
    ContractSettingsService,
    ContractPdfService,
    ContractsRepository,
    ContractCalendarService,
  ],
})
export class ContractsModule {}
