import { Module } from '@nestjs/common';
import { CadencesController } from './cadences.controller';
import { CadencesService } from './cadences.service';
import { CadencesRepository } from './cadences.repository';
import { EnrollmentsRepository } from './enrollments.repository';
import { ResponseClassifierService } from './response-classifier.service';
import { LlmModule } from '../ai-agents/llm/llm.module';

@Module({
  imports: [LlmModule],
  controllers: [CadencesController],
  providers: [
    CadencesService,
    CadencesRepository,
    EnrollmentsRepository,
    ResponseClassifierService,
  ],
  exports: [
    CadencesService,
    CadencesRepository,
    EnrollmentsRepository,
    ResponseClassifierService,
  ],
})
export class CadencesModule {}
