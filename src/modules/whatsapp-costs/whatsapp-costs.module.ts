import { Module } from '@nestjs/common';
import { MetaPricingClient } from './meta-pricing.client';
import { WhatsappCostsController } from './whatsapp-costs.controller';
import { WhatsappCostsRepository } from './whatsapp-costs.repository';
import { WhatsappCostsService } from './whatsapp-costs.service';

/** Custo real do WhatsApp oficial (Meta) e quem gera o custo. Só OWNER/ADMIN. */
@Module({
  controllers: [WhatsappCostsController],
  providers: [MetaPricingClient, WhatsappCostsRepository, WhatsappCostsService],
  exports: [WhatsappCostsService],
})
export class WhatsappCostsModule {}
