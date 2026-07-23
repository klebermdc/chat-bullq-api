import { Module } from '@nestjs/common';
import { CrmReportsController } from './crm-reports.controller';
import { CrmReportsService } from './crm-reports.service';

@Module({
  controllers: [CrmReportsController],
  providers: [CrmReportsService],
})
export class CrmReportsModule {}
