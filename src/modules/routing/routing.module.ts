import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { MessagingModule } from '../messaging/messaging.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DepartmentsController } from './departments/departments.controller';
import { DepartmentsService } from './departments/departments.service';
import { DepartmentsRepository } from './departments/departments.repository';
import { RouterService } from './router.service';
import { WatchdogModule } from './watchdog/watchdog.module';
import { AgentAvailabilityService } from './availability/agent-availability.service';
import { OrgOffHoursNoticeService } from './availability/org-off-hours-notice.service';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: 'conversation-router' },
      // OrgOffHoursNoticeService (modo MESSAGE) enfileira o envio do texto fixo
      // pelo mesmo caminho da IA. RealtimeGateway vem do RealtimeModule (@Global).
      { name: 'outbound-messages' },
    ),
    // Task 4 (agent-hours): InboundMessageProcessor (Messaging) agora chama
    // AgentAvailabilityService (Routing) → ciclo routing↔messaging →
    // forwardRef nos dois lados (mesmo padrão de cadences↔messaging).
    forwardRef(() => MessagingModule),
    NotificationsModule,
    WatchdogModule,
  ],
  controllers: [DepartmentsController],
  providers: [DepartmentsRepository, DepartmentsService, RouterService, AgentAvailabilityService, OrgOffHoursNoticeService],
  exports: [DepartmentsService, DepartmentsRepository, RouterService, AgentAvailabilityService, OrgOffHoursNoticeService],
})
export class RoutingModule {}
