import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ResponseSlaCron } from './response-sla.cron';
import { ResponseSlaNotifier } from './response-sla.notifier';
import { ResponseSlaProcessor } from './response-sla.processor';
import { ResponseSlaRepository } from './response-sla.repository';
import { ResponseSlaScheduler } from './response-sla.scheduler';
import { ResponseSlaStageHandler } from './response-sla-stage.handler';
import { ResponseSlaService } from './response-sla.service';
import { RESPONSE_SLA_QUEUE } from './response-sla.types';

/**
 * SLA de resposta em horário útil (`organizations.settings.responseSlaMinutes`;
 * ausente = desligado). Global para os ganchos (mensagens, conversas, IA)
 * usarem o ResponseSlaService sem criar ciclo entre módulos: aqui só entram
 * Prisma (@Global), a fila e o NotificationsModule, que não importa ninguém.
 */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: RESPONSE_SLA_QUEUE }), NotificationsModule],
  providers: [
    ResponseSlaRepository,
    ResponseSlaScheduler,
    ResponseSlaNotifier,
    ResponseSlaService,
    ResponseSlaStageHandler,
    ResponseSlaProcessor,
    ResponseSlaCron,
  ],
  exports: [ResponseSlaService],
})
export class ResponseSlaModule {}
