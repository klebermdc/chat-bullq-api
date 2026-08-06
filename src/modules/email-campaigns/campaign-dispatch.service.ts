import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EmailCampaignStatus, EmailMessageStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { SubscribersRepository } from '../email-audience/subscribers.repository';
import { buildAudienceWhere, parseAudienceFilter } from '../email-audience/audience-filter';
import { CampaignsService } from './campaigns.service';
import { CampaignsRepository } from './campaigns.repository';
import { CAMPAIGN_SEND_QUEUE, SEND_ATTEMPTS } from './email-campaigns.constants';

export function dedupKeyFor(campaignId: string, subscriberId: string) {
  return `campaign:${campaignId}:${subscriberId}`;
}

@Injectable()
export class CampaignDispatchService {
  private readonly logger = new Logger(CampaignDispatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly campaignsRepo: CampaignsRepository,
    private readonly subscribersRepo: SubscribersRepository,
    @InjectQueue(CAMPAIGN_SEND_QUEUE) private readonly queue: Queue,
  ) {}

  /**
   * Primeiro disparo. Expande o público filtrado e enfileira.
   *
   * `buildAudienceWhere` precisa ser a MESMA função usada por qualquer
   * contagem de público mostrada ao operador antes do envio — nunca duas
   * implementações, senão a contagem prometida diverge do que de fato sai.
   */
  async dispatch(campaignId: string, organizationId: string) {
    const campaign = await this.campaigns.findOne(campaignId, organizationId);
    if (campaign.status !== EmailCampaignStatus.DRAFT) {
      throw new BadRequestException('só é possível disparar campanha em rascunho');
    }

    const where = buildAudienceWhere(organizationId, parseAudienceFilter(campaign.audienceFilter));
    const recipients = await this.subscribersRepo.findByWhere(where);
    if (!recipients.length) {
      // Falha alto: marcar SENT com zero envio esconderia base vazia ou filtro errado.
      throw new BadRequestException('nenhum destinatário elegível para esta campanha');
    }

    // Expansão numa transação só: ou a campanha inteira vira linhas PENDING,
    // ou nada acontece. Sem meia-expansão para descobrir depois.
    await this.prisma.$transaction(async (tx) => {
      await tx.emailMessage.createMany({
        data: recipients.map((r) => ({
          organizationId,
          campaignId,
          subscriberId: r.id,
          to: r.email,
          subject: campaign.subject,
          dedupKey: dedupKeyFor(campaignId, r.id),
          status: EmailMessageStatus.PENDING,
        })),
        // O @@unique em dedup_key é a garantia real; isto evita o erro na 1ª via.
        skipDuplicates: true,
      });
    });

    await this.campaignsRepo.update(campaignId, {
      status: EmailCampaignStatus.SENDING,
      startedAt: new Date(),
      totalRecipients: recipients.length,
    });

    await this.enqueuePending(campaignId);
    this.logger.log(`campanha ${campaignId} disparada para ${recipients.length} destinatário(s)`);
    return { totalRecipients: recipients.length };
  }

  /**
   * Retomada de campanha travada em SENDING. Reenfileira só o que ficou
   * PENDING — seguro porque o `dedupKey` impede envio duplicado.
   */
  async resume(campaignId: string, organizationId: string) {
    const campaign = await this.campaigns.findOne(campaignId, organizationId);
    if (campaign.status !== EmailCampaignStatus.SENDING) {
      throw new BadRequestException('só é possível retomar campanha em envio');
    }
    const requeued = await this.enqueuePending(campaignId);
    return { requeued };
  }

  private async enqueuePending(campaignId: string): Promise<number> {
    const pending = await this.prisma.emailMessage.findMany({
      where: { campaignId, status: EmailMessageStatus.PENDING },
      select: { id: true },
    });
    if (!pending.length) return 0;
    await this.queue.addBulk(
      pending.map((m) => ({
        name: 'send',
        data: { messageId: m.id },
        opts: {
          jobId: `email:${m.id}`, // idempotência também na fila
          attempts: SEND_ATTEMPTS,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
        },
      })),
    );
    return pending.length;
  }
}
