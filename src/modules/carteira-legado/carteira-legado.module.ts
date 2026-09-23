import { Module } from '@nestjs/common';
import { LegacyOwnerWriterService } from './legacy-owner-writer.service';

/**
 * Escrita na carteira legada. Módulo próprio porque dois caminhos de
 * atribuição precisam dele — o FSM (transferir/assumir) e o botão
 * "Distribuir" — e ele só depende do Prisma, então não cria ciclo.
 */
@Module({
  providers: [LegacyOwnerWriterService],
  exports: [LegacyOwnerWriterService],
})
export class CarteiraLegadoModule {}
