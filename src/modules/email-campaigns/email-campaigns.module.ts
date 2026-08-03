import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EmailCoreModule } from '../email-core/email-core.module';
import { EmailAudienceModule } from '../email-audience/email-audience.module';
import { CAMPAIGN_SEND_QUEUE } from './email-campaigns.constants';
import { CampaignsRepository } from './campaigns.repository';
import { CampaignsService } from './campaigns.service';
import { CampaignDispatchService } from './campaign-dispatch.service';
import { CampaignSendProcessor } from './campaign-send.processor';
import { CampaignStatsService } from './campaign-stats.service';
import { CampaignsController } from './campaigns.controller';

@Module({
  imports: [
    BullModule.registerQueue({ name: CAMPAIGN_SEND_QUEUE }),
    EmailCoreModule,
    EmailAudienceModule,
  ],
  controllers: [CampaignsController],
  providers: [
    CampaignsRepository,
    CampaignsService,
    CampaignDispatchService,
    CampaignSendProcessor,
    CampaignStatsService,
  ],
  exports: [CampaignsService],
})
export class EmailCampaignsModule {}
