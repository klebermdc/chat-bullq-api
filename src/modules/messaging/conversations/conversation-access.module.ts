import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../database/prisma.module';
import { ConversationAccessService } from './conversation-access.service';

/**
 * Módulo folha (leaf) — só depende de `PrismaModule` (global). Existe pra
 * que qualquer módulo precise apenas da guarda `assertConversationAccess`
 * sem importar `MessagingModule` inteiro (que carrega AiAgentsModule,
 * SchedulingModule, CadencesModule etc. e já tem vários `forwardRef` entre
 * si). Sem isso, injetar `ConversationsService` só pelo guard foi o que
 * fechou o ciclo de DI que derrubou a produção (ver PR de fix).
 */
@Module({
  imports: [PrismaModule],
  providers: [ConversationAccessService],
  exports: [ConversationAccessService],
})
export class ConversationAccessModule {}
