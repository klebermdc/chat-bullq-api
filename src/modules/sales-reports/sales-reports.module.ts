import { Module } from '@nestjs/common';
import { SalesReportsController } from './sales-reports.controller';
import { SalesReportsService } from './sales-reports.service';
import { OfpReportService } from './ofp-report.service';
import { OfpSyncService } from './ofp-sync.service';
import { OfpSyncCron } from './ofp-sync.cron';
import { OrderCorrelationService } from './order-correlation.service';
import { ReconciliationService } from './reconciliation.service';
import { HubOrderService } from './hub-order.service';
import { PipelinesModule } from '../pipelines/pipelines.module';

@Module({
  imports: [PipelinesModule],
  controllers: [SalesReportsController],
  providers: [
    SalesReportsService,
    OfpReportService,
    OfpSyncService,
    OfpSyncCron,
    OrderCorrelationService,
    ReconciliationService,
    HubOrderService,
  ],
  exports: [SalesReportsService, OfpReportService, OfpSyncService, HubOrderService],
})
export class SalesReportsModule {}
