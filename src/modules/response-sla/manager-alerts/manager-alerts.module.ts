import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { WhatsAppOfficialModule } from '../../channel-hub/adapters/whatsapp-official/whatsapp-official.module';
import { ManagerAlertsController } from './manager-alerts.controller';
import { ManagerAlertsCron } from './manager-alerts.cron';
import { ManagerAlertsProcessor } from './manager-alerts.processor';
import { ManagerAlertsRepository } from './manager-alerts.repository';
import { ManagerAlertsSender } from './manager-alerts.sender';
import { ManagerAlertsService } from './manager-alerts.service';
import { ManagerAlertsThrottle, type ThrottleStore } from './manager-alerts.throttle';
import { MANAGER_ALERTS_QUEUE, MANAGER_ALERTS_THROTTLE } from './manager-alerts.types';

/**
 * Avisos de SLA de resposta para a gestão por WhatsApp
 * (`organizations.settings.slaManagerAlerts`; ausente = desligado).
 * Prisma e ErrorReporter são @Global; o envio usa só o cliente HTTP do
 * WhatsApp oficial (mesmo import do ProposalsModule).
 */
@Module({
  imports: [BullModule.registerQueue({ name: MANAGER_ALERTS_QUEUE }), WhatsAppOfficialModule],
  controllers: [ManagerAlertsController],
  providers: [
    ManagerAlertsRepository,
    ManagerAlertsSender,
    ManagerAlertsService,
    ManagerAlertsProcessor,
    ManagerAlertsCron,
    {
      provide: MANAGER_ALERTS_THROTTLE,
      // A trava usa a conexão Redis da própria fila: sem cliente novo.
      useFactory: (queue: Queue) =>
        new ManagerAlertsThrottle(() => queue.client as unknown as Promise<ThrottleStore>),
      inject: [getQueueToken(MANAGER_ALERTS_QUEUE)],
    },
  ],
  // O gerente no Telegram reaproveita as consultas de esperas e de orgs.
  exports: [ManagerAlertsRepository],
})
export class SlaManagerAlertsModule {}
