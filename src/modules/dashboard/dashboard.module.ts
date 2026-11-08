import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DailyScoreboardService } from './daily-scoreboard/daily-scoreboard.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, DailyScoreboardService],
  exports: [DashboardService, DailyScoreboardService],
})
export class DashboardModule {}
