import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MYSTERY_SHOPPER_QUEUE } from '../mystery-shopper.constants';
import { SimulatedRecipients } from './simulated-recipients.service';
import { SimulatedOutboundAdapter } from './simulated-outbound.adapter';

/**
 * Folha do grafo de módulos: depende só de Prisma (global) e das filas (entrada e
 * mystery-shopper, esta só para acordar o robô). Importado pelo MessagingModule sem risco de ciclo.
 */
@Module({
  imports: [BullModule.registerQueue({ name: 'inbound-messages' }, { name: MYSTERY_SHOPPER_QUEUE })],
  providers: [SimulatedRecipients, SimulatedOutboundAdapter],
  exports: [SimulatedRecipients, SimulatedOutboundAdapter],
})
export class SimulatedModule {}
