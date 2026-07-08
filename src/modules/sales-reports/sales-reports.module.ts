import { Module } from '@nestjs/common';
import { SalesReportsController } from './sales-reports.controller';
import { SalesReportsService } from './sales-reports.service';
import { OfpReportService } from './ofp-report.service';
import { OfpSyncService } from './ofp-sync.service';

@Module({
  controllers: [SalesReportsController],
  providers: [SalesReportsService, OfpReportService, OfpSyncService],
  exports: [SalesReportsService, OfpReportService, OfpSyncService],
})
export class SalesReportsModule {}
