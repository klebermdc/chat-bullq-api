import { Module } from '@nestjs/common';
import { EmailRenderService } from './email-render.service';
import { ResendClient } from './resend.client';
import { EmailSenderService } from './email-sender.service';

@Module({
  providers: [EmailRenderService, ResendClient, EmailSenderService],
  exports: [EmailSenderService, EmailRenderService],
})
export class EmailCoreModule {}
