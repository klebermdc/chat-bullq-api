import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { SlaManagerAlertsModule } from '../response-sla/manager-alerts/manager-alerts.module';
import type { ThrottleStore } from '../response-sla/manager-alerts/manager-alerts.throttle';
import { TeamPresenceModule } from '../team-presence/team-presence.module';
import { TeamPulseController } from './team-pulse.controller';
import { TeamPulseCron, TeamPulseProcessor } from './team-pulse.cron';
import { TeamPulseRepository } from './team-pulse.repository';
import { TeamPulseService } from './team-pulse.service';
import { TeamPulseThrottle } from './team-pulse.throttle';
import { TEAM_PULSE_QUEUE, TEAM_PULSE_THROTTLE } from './team-pulse.types';

/**
 * Pulso do atendimento por WhatsApp para a gestão
 * (`organizations.settings.teamPulse`; ausente = desligado).
 * Reaproveita o envio de template e as consultas de esperas dos avisos de SLA
 * e a presença da equipe. Prisma e ErrorReporter são @Global.
 */
@Module({
  imports: [BullModule.registerQueue({ name: TEAM_PULSE_QUEUE }), SlaManagerAlertsModule, TeamPresenceModule],
  controllers: [TeamPulseController],
  providers: [
    TeamPulseRepository,
    TeamPulseService,
    TeamPulseCron,
    TeamPulseProcessor,
    {
      provide: TEAM_PULSE_THROTTLE,
      // A trava usa a conexão Redis da própria fila: sem cliente novo.
      useFactory: (queue: Queue) =>
        new TeamPulseThrottle(() => queue.client as unknown as Promise<ThrottleStore>),
      inject: [getQueueToken(TEAM_PULSE_QUEUE)],
    },
  ],
})
export class TeamPulseModule {}
