import { Module } from '@nestjs/common';
import { CadencesController } from './cadences.controller';
import { CadencesService } from './cadences.service';
import { CadencesRepository } from './cadences.repository';
import { EnrollmentsRepository } from './enrollments.repository';

@Module({
  controllers: [CadencesController],
  providers: [CadencesService, CadencesRepository, EnrollmentsRepository],
  exports: [CadencesService, CadencesRepository, EnrollmentsRepository],
})
export class CadencesModule {}
