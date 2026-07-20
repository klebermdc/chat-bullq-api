import { Module } from '@nestjs/common';
import { ChannelUsageController } from './channel-usage.controller';
import { ChannelUsageService } from './channel-usage.service';

@Module({
  controllers: [ChannelUsageController],
  providers: [ChannelUsageService],
  exports: [ChannelUsageService],
})
export class ChannelUsageModule {}
