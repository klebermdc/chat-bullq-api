import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CadencesController } from './cadences.controller';
import { CadencesService } from './cadences.service';
import { CadencesRepository } from './cadences.repository';
import { EnrollmentsRepository } from './enrollments.repository';
import { ResponseClassifierService } from './response-classifier.service';
import {
  CadenceTransitionService,
  CADENCE_RUNNER,
} from './cadence-transition.service';
import { CadenceRunner } from './cadence-runner.service';
import { CadenceInboundService } from './cadence-inbound.service';
import { LlmModule } from '../ai-agents/llm/llm.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { MessagingModule } from '../messaging/messaging.module';
import {
  SCHEDULED_DISPATCH_QUEUE,
  CADENCE_SILENCE_QUEUE,
} from '../scheduling/scheduling.constants';

@Module({
  imports: [
    LlmModule,
    NotificationsModule,
    RealtimeModule,
    // Task 8: scheduling↔cadences cycle (dispatch processor chama onStepSent) e
    // messaging↔cadences cycle (inbound processor chama CadenceInboundService)
    // → forwardRef nos dois lados para o app bootar.
    forwardRef(() => SchedulingModule),
    forwardRef(() => MessagingModule),
    // Necessário para `@InjectQueue(SCHEDULED_DISPATCH_QUEUE)` no runner.
    BullModule.registerQueue({ name: SCHEDULED_DISPATCH_QUEUE }),
    // Necessário para `@InjectQueue(CADENCE_SILENCE_QUEUE)` no runner.
    BullModule.registerQueue({ name: CADENCE_SILENCE_QUEUE }),
  ],
  controllers: [CadencesController],
  providers: [
    CadencesService,
    CadencesRepository,
    EnrollmentsRepository,
    ResponseClassifierService,
    CadenceTransitionService,
    CadenceRunner,
    CadenceInboundService,
    // Task 7: runner real substitui o stub. Sem ciclo runtime: o runner não
    // depende do transition service, então `useExisting` basta (sem forwardRef).
    { provide: CADENCE_RUNNER, useExisting: CadenceRunner },
  ],
  exports: [
    CadencesService,
    CadencesRepository,
    EnrollmentsRepository,
    ResponseClassifierService,
    CadenceTransitionService,
    CadenceRunner,
    CadenceInboundService,
  ],
})
export class CadencesModule {}
