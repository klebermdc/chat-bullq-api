import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PushDispatchService } from './push-dispatch.service';
import { PushSenderService } from './push-sender.service';
import { PushSubscriptionsService } from './push-subscriptions.service';

/** Web Push do vendedor. `RealtimeModule` e `PrismaModule` são globais. */
@Module({
  controllers: [PushController],
  providers: [PushSubscriptionsService, PushSenderService, PushDispatchService],
  exports: [PushDispatchService],
})
export class PushModule {}
