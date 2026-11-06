import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SupportTicketsService } from './support-tickets.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [PrismaModule, RealtimeModule, NotificationsModule],
  providers: [SupportTicketsService],
  exports: [SupportTicketsService],
})
export class SupportTicketsModule {}
