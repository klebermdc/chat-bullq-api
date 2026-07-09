import { Module } from '@nestjs/common';
import { LeadIntakeController } from './lead-intake.controller';
import { LeadIntakeService } from './lead-intake.service';

@Module({
  controllers: [LeadIntakeController],
  providers: [LeadIntakeService],
})
export class LeadIntakeModule {}
