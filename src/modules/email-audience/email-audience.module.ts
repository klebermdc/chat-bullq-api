import { Module } from '@nestjs/common';
import { SubscribersRepository } from './subscribers.repository';
import { SubscribersService } from './subscribers.service';
import { SuppressionService } from './suppression.service';
import { SubscriberImportService } from './subscriber-import.service';
import { SubscribersController } from './subscribers.controller';

@Module({
  controllers: [SubscribersController],
  providers: [SubscribersRepository, SubscribersService, SuppressionService, SubscriberImportService],
  exports: [SubscribersService, SuppressionService, SubscribersRepository],
})
export class EmailAudienceModule {}
