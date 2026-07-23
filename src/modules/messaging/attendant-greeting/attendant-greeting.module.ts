import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../database/prisma.module';
import { MessagingModule } from '../messaging.module';
import { AttendantGreetingService } from './attendant-greeting.service';
import { AttendantGreetingSettingsService } from './attendant-greeting-settings.service';
import { AttendantGreetingSettingsRepository } from './attendant-greeting-settings.repository';
import { AttendantGreetingSettingsController } from './attendant-greeting-settings.controller';

@Module({
  imports: [PrismaModule, forwardRef(() => MessagingModule)],
  controllers: [AttendantGreetingSettingsController],
  providers: [
    AttendantGreetingService,
    AttendantGreetingSettingsService,
    AttendantGreetingSettingsRepository,
  ],
  exports: [AttendantGreetingService, AttendantGreetingSettingsService],
})
export class AttendantGreetingModule {}
