import { Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { resolveAssignmentScope } from './conversation-scope';

/**
 * Guarda de acesso a conversas — extraída de `ConversationsService` pra ser
 * um leaf service (só depende de `PrismaService`), consumível por qualquer
 * módulo sem herdar o grafo de DI pesado de `ConversationsService`
 * (AiAgentsModule, SchedulingModule, CadencesModule, etc). Um RBAC anterior
 * injetou `ConversationsService` inteiro em vários módulos só por causa
 * desse método e fechou um ciclo de DI que derrubou a produção — ver
 * `conversation-access.module.ts`.
 *
 * Garante que o usuário pode agir sobre a conversa.
 * AGENT só alcança conversa atribuída a ele. OWNER/ADMIN passam direto.
 * Lança NotFound — e não Forbidden — para não confirmar a existência da conversa alheia.
 *
 * Guarda ÚNICA e compartilhada para os métodos de escrita (update, transfer,
 * toggleAi, engageAi, setActiveAgent, close, reopen, assignToMe) e reusada
 * pelo MessagesService (send/revoke). Propositalmente NÃO reusa `findOne`:
 * esta checagem é barata (um único findFirst) e não faz o attachProjects
 * que as mutações não precisam.
 */
@Injectable()
export class ConversationAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertConversationAccess(
    id: string,
    organizationId: string,
    role?: OrgRole,
    currentUserId?: string,
  ) {
    // Sem currentUserId = chamador de sistema (cadência, webhook, automação,
    // agente de IA) — mantém irrestrito, igual ao resto do arquivo.
    const scoped = currentUserId
      ? resolveAssignmentScope(role, currentUserId)
      : undefined;
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        id,
        organizationId,
        ...(scoped ? { assignedToId: scoped } : {}),
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    return conversation;
  }
}
