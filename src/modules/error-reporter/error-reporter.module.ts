import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ErrorAlertService } from './error-alert.service';
import { ErrorReporterService } from './error-reporter.service';
import { ErrorRetentionCron } from './error-retention.cron';
import {
  ERROR_RETENTION_QUEUE,
  ErrorRetentionProcessor,
} from './error-retention.processor';

/**
 * @Global de propósito, e SEM importar nenhum módulo de domínio.
 *
 * Este serviço é injetado em quase todo canto do sistema. Se ele dependesse
 * de qualquer módulo de negócio, fecharia um ciclo de DI — a falha que matou
 * a produção no PR #94 e no ToolRegistry, e que o `di-cycle-guard.spec.ts`
 * existe para pegar em ~1s. Só PrismaModule (já @Global) e ConfigModule
 * (já isGlobal no AppModule) são aceitáveis aqui.
 *
 * `BullModule` também é aceitável: é infraestrutura (fila/agendamento), não
 * um módulo de domínio — mesmo raciocínio que já vale para Prisma/Config.
 *
 * Se algum dia você precisar importar um módulo de domínio aqui, a resposta
 * certa é inverter a dependência, não adicionar o import.
 */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: ERROR_RETENTION_QUEUE })],
  providers: [
    ErrorReporterService,
    ErrorAlertService,
    ErrorRetentionCron,
    ErrorRetentionProcessor,
  ],
  exports: [ErrorReporterService],
})
export class ErrorReporterModule {}
