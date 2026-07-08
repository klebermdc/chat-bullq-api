import { Module } from '@nestjs/common';
import { SalesReportsController } from './sales-reports.controller';
import { SalesReportsService } from './sales-reports.service';
import { OfpReportService } from './ofp-report.service';
import { OfpSyncService } from './ofp-sync.service';
import { OfpSyncCron } from './ofp-sync.cron';

@Module({
  controllers: [SalesReportsController],
  providers: [SalesReportsService, OfpReportService, OfpSyncService, OfpSyncCron],
  exports: [SalesReportsService, OfpReportService, OfpSyncService],
})
export class SalesReportsModule {}
