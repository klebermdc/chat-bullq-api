import { Module } from '@nestjs/common';
import { SalesReportsController } from './sales-reports.controller';
import { SalesReportsService } from './sales-reports.service';
import { OfpReportService } from './ofp-report.service';

@Module({
  controllers: [SalesReportsController],
  providers: [SalesReportsService, OfpReportService],
  exports: [SalesReportsService, OfpReportService],
})
export class SalesReportsModule {}
