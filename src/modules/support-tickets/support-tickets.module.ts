import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { SupportTicketsService } from './support-tickets.service';

@Module({
  imports: [PrismaModule, RealtimeModule],
  providers: [SupportTicketsService],
  exports: [SupportTicketsService],
})
export class SupportTicketsModule {}
