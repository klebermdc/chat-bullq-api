import { Module, forwardRef } from '@nestjs/common';
import { PipelinesController } from './pipelines.controller';
import { PipelinesService } from './pipelines.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { CadencesModule } from '../cadences/cadences.module';

@Module({
  // Task 8: moveCard chama CadenceRunner.maybeStartForStage → ciclo
  // pipelines↔cadences → forwardRef nos dois lados.
  imports: [RealtimeModule, forwardRef(() => CadencesModule)],
  controllers: [PipelinesController],
  providers: [PipelinesService],
  exports: [PipelinesService],
})
export class PipelinesModule {}
