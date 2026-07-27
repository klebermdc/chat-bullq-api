import { Module, forwardRef } from '@nestjs/common';
import { PipelinesController } from './pipelines.controller';
import { PipelinesService } from './pipelines.service';
import { RealtimeModule } from '../realtime/realtime.module';
import { CadencesModule } from '../cadences/cadences.module';
import { MetaCapiModule } from '../meta-capi/meta-capi.module';
import { AcceptancesModule } from '../acceptances/acceptances.module';
import { MessagingModule } from '../messaging/messaging.module';

@Module({
  // Task 8: moveCard chama CadenceRunner.maybeStartForStage → ciclo
  // pipelines↔cadences → forwardRef nos dois lados.
  // MetaCapiModule: moveCard enfileira o Purchase quando o card fecha em WON.
  // Task 10 (aceite): markOrderSent gera o aceite (AcceptancesModule — aresta
  // limpa, só importa Prisma) e envia o link via MessagesService. MessagingModule
  // importa (via SalesRecovery) o PipelinesModule → ciclo pipelines↔messaging →
  // forwardRef aqui + forwardRef(() => PipelinesModule) no SalesRecoveryModule.
  imports: [
    RealtimeModule,
    forwardRef(() => CadencesModule),
    MetaCapiModule,
    AcceptancesModule,
    forwardRef(() => MessagingModule),
  ],
  controllers: [PipelinesController],
  providers: [PipelinesService],
  exports: [PipelinesService],
})
export class PipelinesModule {}
