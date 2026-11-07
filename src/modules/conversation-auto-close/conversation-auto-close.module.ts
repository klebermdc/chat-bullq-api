import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AutoCloseCron } from './auto-close.cron';
import { AUTO_CLOSE_QUEUE, AutoCloseProcessor } from './auto-close.processor';

/**
 * Fecha conversas paradas além do prazo de cada org
 * (`organizations.settings.autoCloseInactiveDays`; ausente = desligado).
 * Só depende de Prisma e ErrorReporter (ambos @Global): sem risco de ciclo.
 */
@Module({
  imports: [BullModule.registerQueue({ name: AUTO_CLOSE_QUEUE })],
  providers: [AutoCloseCron, AutoCloseProcessor],
})
export class ConversationAutoCloseModule {}
