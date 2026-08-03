import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EmailCampaignStatus, EmailMessageStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { EmailSenderService } from '../email-core/email-sender.service';
import { EmailContent } from '../email-core/email-blocks.types';
import { SubscribersService } from '../email-audience/subscribers.service';
import { SuppressionService } from '../email-audience/suppression.service';
import { CampaignsRepository } from './campaigns.repository';
import { CAMPAIGN_SEND_QUEUE, SEND_RATE_PER_SECOND } from './email-campaigns.constants';

@Processor(CAMPAIGN_SEND_QUEUE, {
  concurrency: 4,
  limiter: { max: SEND_RATE_PER_SECOND, duration: 1000 },
})
export class CampaignSendProcessor extends WorkerHost {
  private readonly logger = new Logger(CampaignSendProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: EmailSenderService,
    private readonly subscribers: SubscribersService,
    private readonly suppression: SuppressionService,
    private readonly campaignsRepo: CampaignsRepository,
  ) {
    super();
  }

  async process(job: Job<{ messageId: string }>): Promise<void> {
    const message = await this.prisma.emailMessage.findUnique({
      where: { id: job.data.messageId },
      include: { campaign: true },
    });
    if (!message || message.status !== EmailMessageStatus.PENDING) return;

    const campaign = (message as any).campaign;
    if (!campaign) return;

    // O estado do destinatário pode ter mudado entre a expansão e o envio —
    // alguém pode ter descadastrado no meio da campanha.
    const subscriber = message.subscriberId
      ? await this.subscribers.findById(message.subscriberId)
      : null;
    const verdict = this.suppression.canReceive(subscriber);
    if (!verdict.allowed) {
      await this.prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: EmailMessageStatus.FAILED, failedReason: `suprimido: ${verdict.reason}` },
      });
      await this.finishIfDone(campaign.id);
      return;
    }

    await this.sender.send({
      organizationId: message.organizationId,
      campaignId: campaign.id,
      subscriberId: message.subscriberId ?? undefined,
      to: message.to,
      name: subscriber?.name ?? undefined,
      subject: campaign.subject,
      preheader: campaign.preheader ?? undefined,
      fromName: campaign.fromName ?? undefined,
      content: campaign.content as unknown as EmailContent,
      dedupKey: message.dedupKey ?? undefined,
    });

    await this.finishIfDone(campaign.id);
  }

  /** Fecha a campanha quando não sobra nenhuma mensagem PENDING. */
  private async finishIfDone(campaignId: string) {
    const pending = await this.prisma.emailMessage.count({
      where: { campaignId, status: EmailMessageStatus.PENDING },
    });
    if (pending > 0) return;
    await this.campaignsRepo.update(campaignId, {
      status: EmailCampaignStatus.SENT,
      finishedAt: new Date(),
    });
  }
}
