import { Module, forwardRef } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { EmailAudienceModule } from '../email-audience/email-audience.module';
import { EmailRenderService } from './email-render.service';
import { ResendClient } from './resend.client';
import { EmailSenderService } from './email-sender.service';
import { EmailEventsService } from './email-events.service';
import { ResendWebhookController } from './resend-webhook.controller';
import { UnsubscribeController } from './unsubscribe.controller';
import { PreviewController } from './preview.controller';

@Module({
  imports: [NotificationsModule, forwardRef(() => EmailAudienceModule)],
  controllers: [ResendWebhookController, UnsubscribeController, PreviewController],
  providers: [EmailRenderService, ResendClient, EmailSenderService, EmailEventsService],
  exports: [EmailSenderService, EmailRenderService, EmailEventsService],
})
export class EmailCoreModule {}
