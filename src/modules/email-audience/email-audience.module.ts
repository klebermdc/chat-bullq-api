import { Module } from '@nestjs/common';
import { HubSalesMirrorAccess } from '../../common/hub-sales-mirror';
import { TagsModule } from '../tags/tags.module';
import { SubscribersRepository } from './subscribers.repository';
import { SubscribersService } from './subscribers.service';
import { SuppressionService } from './suppression.service';
import { SubscriberImportService } from './subscriber-import.service';
import { SubscribersController } from './subscribers.controller';

@Module({
  imports: [TagsModule],
  controllers: [SubscribersController],
  providers: [
    SubscribersRepository,
    SubscribersService,
    SuppressionService,
    SubscriberImportService,
    HubSalesMirrorAccess,
  ],
  exports: [SubscribersService, SuppressionService, SubscribersRepository],
})
export class EmailAudienceModule {}
