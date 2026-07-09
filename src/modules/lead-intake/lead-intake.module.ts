import { Module } from '@nestjs/common';
import { LeadIntakeController } from './lead-intake.controller';
import { LeadIntakeAdminController } from './lead-intake-admin.controller';
import { LeadIntakeService } from './lead-intake.service';

@Module({
  controllers: [LeadIntakeController, LeadIntakeAdminController],
  providers: [LeadIntakeService],
})
export class LeadIntakeModule {}
