import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SimulatedRecipients } from './simulated-recipients.service';
import { SimulatedOutboundAdapter } from './simulated-outbound.adapter';

/**
 * Folha do grafo de módulos: depende só de Prisma (global) e da fila de
 * entrada. Importado pelo MessagingModule sem risco de ciclo.
 */
@Module({
  imports: [BullModule.registerQueue({ name: 'inbound-messages' })],
  providers: [SimulatedRecipients, SimulatedOutboundAdapter],
  exports: [SimulatedRecipients, SimulatedOutboundAdapter],
})
export class SimulatedModule {}
