import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { AcceptancesModule } from '../acceptances/acceptances.module';
import { ConversationAccessModule } from '../messaging/conversations/conversation-access.module';
import { MessagingModule } from '../messaging/messaging.module';
import { LlmModule } from '../ai-agents/llm/llm.module';
import { FieldDefaultsService } from './field-defaults.service';
import { ContactPersonalDataService } from './personal-data.service';
import { AiFillService } from './ai-fill.service';
import { DocumentTemplatesController } from './document-templates.controller';
import { ConversationContractsController } from './conversation-contracts.controller';
import { DocumentTemplatesService } from './document-templates.service';
import { ConversationContractsService } from './conversation-contracts.service';

/**
 * Modelos de documento (contratos com `[Campo]`) e o envio do contrato ao
 * cliente pelo link de aceite. MessagingModule via forwardRef pelo mesmo
 * motivo do PipelinesModule (o grafo de messaging tem ciclos).
 */
@Module({
  imports: [
    PrismaModule,
    AcceptancesModule,
    ConversationAccessModule,
    LlmModule,
    forwardRef(() => MessagingModule),
  ],
  controllers: [DocumentTemplatesController, ConversationContractsController],
  providers: [
    DocumentTemplatesService,
    ConversationContractsService,
    FieldDefaultsService,
    ContactPersonalDataService,
    AiFillService,
  ],
})
export class DocumentTemplatesModule {}
