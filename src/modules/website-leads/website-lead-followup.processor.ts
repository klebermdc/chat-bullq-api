import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { WebsiteLeadFollowupService } from './website-lead-followup.service';
import { WEBSITE_LEAD_FOLLOWUP_QUEUE } from './website-leads.constants';

@Processor(WEBSITE_LEAD_FOLLOWUP_QUEUE, { concurrency: 4 })
export class WebsiteLeadFollowupProcessor extends WorkerHost {
  constructor(private readonly followup: WebsiteLeadFollowupService) {
    super();
  }

  async process(job: Job<{ submissionId: string }>) {
    return this.followup.fire(job.data.submissionId);
  }
}
