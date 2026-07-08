import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { SCHEDULED_DISPATCH_QUEUE } from './scheduling.constants';

@Module({
  imports: [BullModule.registerQueue({ name: SCHEDULED_DISPATCH_QUEUE })],
  controllers: [],
  providers: [],
  exports: [],
})
export class SchedulingModule {}
