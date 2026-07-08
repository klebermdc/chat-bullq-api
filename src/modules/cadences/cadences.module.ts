import { Module } from '@nestjs/common';
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
import { LlmModule } from '../ai-agents/llm/llm.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { SCHEDULED_DISPATCH_QUEUE } from '../scheduling/scheduling.constants';

@Module({
  imports: [
    LlmModule,
    NotificationsModule,
    RealtimeModule,
    SchedulingModule,
    // Necessário para `@InjectQueue(SCHEDULED_DISPATCH_QUEUE)` no runner.
    BullModule.registerQueue({ name: SCHEDULED_DISPATCH_QUEUE }),
  ],
  controllers: [CadencesController],
  providers: [
    CadencesService,
    CadencesRepository,
    EnrollmentsRepository,
    ResponseClassifierService,
    CadenceTransitionService,
    CadenceRunner,
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
  ],
})
export class CadencesModule {}
