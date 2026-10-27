import { Module } from '@nestjs/common';
import { LlmModule } from '../ai-agents/llm/llm.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ConversationAccessModule } from '../messaging/conversations/conversation-access.module';
import { PipelinesModule } from '../pipelines/pipelines.module';
import { OrderFichaModule } from '../order-ficha/order-ficha.module';
import { ProposalsController } from './proposals.controller';
import { ProposalsService } from './proposals.service';
import { ProposalsRepository } from './proposals.repository';
import { RenderService } from './render.service';
import { ExtractionService } from './extraction.service';
import { WhatsAppOfficialModule } from '../channel-hub/adapters/whatsapp-official/whatsapp-official.module';
import { PublicQuotesController } from './quote/public-quotes.controller';
import { PublicQuotesService } from './quote/public-quotes.service';
import { SellerWhatsappService } from './quote/seller-whatsapp.service';
import { QuotePdfService } from './quote/quote-pdf';
import { HotelLookupService } from './quote/hotel/hotel-lookup.service';
import { LiteapiClient } from './quote/hotel/liteapi.client';

// PrismaService vem do PrismaModule, que é @Global (não precisa import aqui).
// OrderFichaModule não importa ProposalsModule nem MessagingModule (só usa o
// tipo ExtractedCart de proposals.types, import type-only) — sem ciclo, não
// precisa de forwardRef.
@Module({
  imports: [
    LlmModule,
    MessagingModule,
    ConversationAccessModule,
    PipelinesModule,
    OrderFichaModule,
    // Número do canal (display_phone_number) para o botão de WhatsApp da cotação.
    WhatsAppOfficialModule,
  ],
  controllers: [ProposalsController, PublicQuotesController],
  providers: [
    ProposalsService,
    ProposalsRepository,
    ExtractionService,
    HotelLookupService,
    // Param defaulted (env): factory explícita, como o RenderService.
    { provide: LiteapiClient, useFactory: () => new LiteapiClient() },
    // RenderService tem um param defaulted (BrowserType) que o Nest não
    // consegue auto-resolver — precisa de factory explícita.
    { provide: RenderService, useFactory: () => new RenderService() },
    // Mesmo motivo: BrowserType defaulted.
    { provide: QuotePdfService, useFactory: () => new QuotePdfService() },
    PublicQuotesService,
    SellerWhatsappService,
  ],
})
export class ProposalsModule {}
