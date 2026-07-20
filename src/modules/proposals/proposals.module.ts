import { Module } from '@nestjs/common';
import { LlmModule } from '../ai-agents/llm/llm.module';
import { MessagingModule } from '../messaging/messaging.module';
import { PipelinesModule } from '../pipelines/pipelines.module';
import { OrderFichaModule } from '../order-ficha/order-ficha.module';
import { ProposalsController } from './proposals.controller';
import { ProposalsService } from './proposals.service';
import { ProposalsRepository } from './proposals.repository';
import { RenderService } from './render.service';
import { ExtractionService } from './extraction.service';

// PrismaService vem do PrismaModule, que é @Global (não precisa import aqui).
// OrderFichaModule não importa ProposalsModule nem MessagingModule (só usa o
// tipo ExtractedCart de proposals.types, import type-only) — sem ciclo, não
// precisa de forwardRef.
@Module({
  imports: [LlmModule, MessagingModule, PipelinesModule, OrderFichaModule],
  controllers: [ProposalsController],
  providers: [
    ProposalsService,
    ProposalsRepository,
    ExtractionService,
    // RenderService tem um param defaulted (BrowserType) que o Nest não
    // consegue auto-resolver — precisa de factory explícita.
    { provide: RenderService, useFactory: () => new RenderService() },
  ],
})
export class ProposalsModule {}
