import { Module } from '@nestjs/common';
import { ContractsImportController } from './legacy/contracts-import.controller';
import { ContractsImportService } from './legacy/contracts-import.service';

// StorageModule é @Global(): StorageService já é injetável sem importar o módulo.
@Module({
  controllers: [ContractsImportController],
  providers: [ContractsImportService],
})
export class ContractsModule {}
