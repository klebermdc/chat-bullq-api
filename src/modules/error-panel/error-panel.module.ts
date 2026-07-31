import { Module } from '@nestjs/common';
import { ErrorPanelController } from './error-panel.controller';
import { ErrorPanelService } from './error-panel.service';

/**
 * Módulo comum, NÃO global, e sem imports: `PrismaModule` já é `@Global()`.
 * Deliberadamente separado do `ErrorReporterModule` (escrita), que precisa
 * continuar sem controller e sem guard para não atrair ciclo de DI.
 */
@Module({
  controllers: [ErrorPanelController],
  providers: [ErrorPanelService],
})
export class ErrorPanelModule {}
