import { Module } from '@nestjs/common';
import { CadencesController } from './cadences.controller';
import { CadencesService } from './cadences.service';
import { CadencesRepository } from './cadences.repository';
import { EnrollmentsRepository } from './enrollments.repository';
import { ResponseClassifierService } from './response-classifier.service';
import {
  CadenceTransitionService,
  CADENCE_RUNNER,
  CadenceRunnerPort,
} from './cadence-transition.service';
import { LlmModule } from '../ai-agents/llm/llm.module';
import { NotificationsModule } from '../notifications/notifications.module';

// TODO(Task 7): remover este stub e registrar o runner real com
// `{ provide: CADENCE_RUNNER, useExisting: CadenceRunner }` (forwardRef no
// import de CadenceRunner). Por ora, mantém o módulo bootável; o transition
// service só precisa de `stop()`.
const cadenceRunnerStub: CadenceRunnerPort = {
  stop: async () => undefined,
};

@Module({
  imports: [LlmModule, NotificationsModule],
  controllers: [CadencesController],
  providers: [
    CadencesService,
    CadencesRepository,
    EnrollmentsRepository,
    ResponseClassifierService,
    CadenceTransitionService,
    { provide: CADENCE_RUNNER, useValue: cadenceRunnerStub },
  ],
  exports: [
    CadencesService,
    CadencesRepository,
    EnrollmentsRepository,
    ResponseClassifierService,
    CadenceTransitionService,
  ],
})
export class CadencesModule {}
