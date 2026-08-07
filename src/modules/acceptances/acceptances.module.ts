import { Module } from '@nestjs/common';
import { chromium } from 'playwright';

import { PrismaModule } from '../../database/prisma.module';
import { LlmModule } from '../ai-agents/llm/llm.module';
import { AcceptancesService } from './acceptances.service';
import { VoucherExtractorService } from './voucher-extractor.service';
import { AcceptancePdfService } from './acceptance-pdf.service';
import { AcceptanceEffectsService } from './acceptance-effects.service';
import { AcceptancesController } from './acceptances.controller';
import { PublicAcceptancesController } from './public-acceptances.controller';

/**
 * Módulo do Aceite de Entrega.
 *
 * `StorageModule` (MinIO) e `RealtimeModule` são @Global — registrados uma vez
 * no AppModule — então não precisam ser importados aqui (mesmo padrão de
 * `OrderFichaModule`, que injeta `RealtimeGateway`/`StorageService` sem
 * importar os módulos). Só `PrismaModule` precisa vir explícito.
 *
 * `AcceptancePdfService` recebe um `BrowserType` no construtor, que o Nest não
 * sabe resolver — por isso é provido via `useFactory` com o `chromium` real.
 */
@Module({
  imports: [PrismaModule, LlmModule],
  controllers: [AcceptancesController, PublicAcceptancesController],
  providers: [
    AcceptancesService,
    AcceptanceEffectsService,
    VoucherExtractorService,
    { provide: AcceptancePdfService, useFactory: () => new AcceptancePdfService(chromium) },
  ],
  exports: [AcceptancesService],
})
export class AcceptancesModule {}
