import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ConversationActor, ConversationGuardService } from './conversation-guard.service';

/**
 * Acesso do operador a UM aceite (entrega ou contrato) por id: org do JWT e,
 * além dela, a conversa do aceite pela mesma guarda do envio. Sem isso um
 * AGENT baixava o PDF (nome, IP, assinatura) ou reenviava o link de um aceite
 * da conversa de um colega só por saber o id.
 */
@Injectable()
export class AcceptanceAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly guard: ConversationGuardService,
  ) {}

  async assertAccess(actor: ConversationActor, acceptanceId: string): Promise<void> {
    const acc = await this.prisma.orderAcceptance.findFirst({
      where: { id: acceptanceId, organizationId: actor.organizationId },
      select: { conversationId: true },
    });
    if (!acc) throw new NotFoundException('Aceite não encontrado.');
    await this.guard.assertCanUse(actor, acc.conversationId);
  }
}
