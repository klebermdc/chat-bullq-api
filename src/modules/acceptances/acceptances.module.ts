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
import { ConversationAccessModule } from '../messaging/conversations/conversation-access.module';
import { ConversationGuardService } from './conversation-guard.service';
import { AcceptanceAccessService } from './acceptance-access.service';

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
  imports: [PrismaModule, LlmModule, ConversationAccessModule],
  controllers: [AcceptancesController, PublicAcceptancesController],
  providers: [
    AcceptancesService,
    AcceptanceEffectsService,
    ConversationGuardService,
    AcceptanceAccessService,
    VoucherExtractorService,
    { provide: AcceptancePdfService, useFactory: () => new AcceptancePdfService(chromium) },
  ],
  // AcceptancePdfService: o PDF de modelo interno (document-templates) usa o
  // mesmo pipeline do comprovante.
  exports: [AcceptancesService, AcceptancePdfService, ConversationGuardService],
})
export class AcceptancesModule {}
