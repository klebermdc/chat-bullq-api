import { Global, Module } from '@nestjs/common';
import { ErrorAlertService } from './error-alert.service';
import { ErrorReporterService } from './error-reporter.service';

/**
 * @Global de propósito, e SEM importar nenhum módulo de domínio.
 *
 * Este serviço é injetado em quase todo canto do sistema. Se ele dependesse
 * de qualquer módulo de negócio, fecharia um ciclo de DI — a falha que matou
 * a produção no PR #94 e no ToolRegistry, e que o `di-cycle-guard.spec.ts`
 * existe para pegar em ~1s. Só PrismaModule (já @Global) e ConfigModule
 * (já isGlobal no AppModule) são aceitáveis aqui.
 *
 * Se algum dia você precisar importar um módulo de domínio aqui, a resposta
 * certa é inverter a dependência, não adicionar o import.
 */
@Global()
@Module({
  providers: [ErrorReporterService, ErrorAlertService],
  exports: [ErrorReporterService],
})
export class ErrorReporterModule {}
