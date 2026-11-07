import { forwardRef, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MessagingModule } from '../messaging/messaging.module';
import { WebsiteLeadFollowupProcessor } from './website-lead-followup.processor';
import { WebsiteLeadFollowupService } from './website-lead-followup.service';
import { WebsiteLeadInboundService } from './website-lead-inbound.service';
import { WebsiteLeadIntakeService } from './website-lead-intake.service';
import { WebsiteLeadOriginService } from './website-lead-origin.service';
import { WebsiteLeadSettingsService } from './website-lead-settings.service';
import { WebsiteLeadsController } from './website-leads.controller';
import { WebsiteLeadsPublicController } from './website-leads-public.controller';
import { WEBSITE_LEAD_FOLLOWUP_QUEUE } from './website-leads.constants';

/**
 * Leads do formulário do site: entrada pública, retorno automático pelo
 * WhatsApp oficial com a Aline e o bloco "Origem" do contato. Ciclo com o
 * MessagingModule (o inbound consulta o `WebsiteLeadInboundService`; o
 * retorno usa o start-conversation e a carteira) → forwardRef nos dois lados.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: WEBSITE_LEAD_FOLLOWUP_QUEUE }, { name: 'outbound-messages' }),
    forwardRef(() => MessagingModule),
  ],
  controllers: [WebsiteLeadsPublicController, WebsiteLeadsController],
  providers: [
    WebsiteLeadSettingsService,
    WebsiteLeadIntakeService,
    WebsiteLeadFollowupService,
    WebsiteLeadFollowupProcessor,
    WebsiteLeadInboundService,
    WebsiteLeadOriginService,
  ],
  exports: [WebsiteLeadInboundService],
})
export class WebsiteLeadsModule {}
