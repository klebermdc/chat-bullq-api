import { Module, forwardRef } from '@nestjs/common';
import { PipelinesController } from './pipelines.controller';
import { PipelinesService } from './pipelines.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { CadencesModule } from '../cadences/cadences.module';
import { MetaCapiModule } from '../meta-capi/meta-capi.module';

@Module({
  // Task 8: moveCard chama CadenceRunner.maybeStartForStage → ciclo
  // pipelines↔cadences → forwardRef nos dois lados.
  // MetaCapiModule: moveCard enfileira o Purchase quando o card fecha em WON.
  imports: [RealtimeModule, forwardRef(() => CadencesModule), MetaCapiModule],
  controllers: [PipelinesController],
  providers: [PipelinesService],
  exports: [PipelinesService],
})
export class PipelinesModule {}
