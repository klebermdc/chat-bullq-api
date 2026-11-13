import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AgendaController } from './agenda.controller';
import { AgendaReminderProcessor } from './agenda.processor';
import { AGENDA_REMINDER_QUEUE } from './agenda.reminders';
import { AgendaRepository } from './agenda.repository';
import { AgendaReminderScheduler } from './agenda.scheduler';
import { AgendaService } from './agenda.service';

@Module({
  imports: [BullModule.registerQueue({ name: AGENDA_REMINDER_QUEUE }), NotificationsModule],
  controllers: [AgendaController],
  providers: [AgendaRepository, AgendaService, AgendaReminderScheduler, AgendaReminderProcessor],
  exports: [AgendaService],
})
export class AgendaModule {}
