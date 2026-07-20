import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { OrderFichaStatus } from '@prisma/client';
import { Divergence, OrderItem } from './order-ficha.types';

export interface UpsertOrderInput {
  organizationId: string;
  contactId: string;
  conversationId: string;
  items: OrderItem[];
  travelDatesText: string | null;
  travelStart: Date | null;
  travelEnd: Date | null;
  requestedAt: Date | null;
  sourceMessageId: string | null;
}

@Injectable()
export class OrderFichaRepository {
  constructor(private readonly prisma: PrismaService) {}

  upsertOrder(input: UpsertOrderInput) {
    const data = {
      items: input.items as any,
      travelDatesText: input.travelDatesText,
      travelStart: input.travelStart,
      travelEnd: input.travelEnd,
      requestedAt: input.requestedAt,
      sourceMessageId: input.sourceMessageId,
      status: OrderFichaStatus.ORDER_LOGGED,
    };
    return this.prisma.orderFicha.upsert({
      where: { conversationId: input.conversationId },
      create: {
        organizationId: input.organizationId,
        contactId: input.contactId,
        conversationId: input.conversationId,
        ...data,
      },
      update: data,
    });
  }

  findByConversation(conversationId: string) {
    return this.prisma.orderFicha.findUnique({ where: { conversationId } });
  }

  /**
   * Fichas que registraram um pedido mas ainda não têm carrinho: o cliente
   * pediu (`requestedAt` preenchido), nenhuma proposta foi vinculada
   * (`lastProposalId` nulo) e o status segue em `ORDER_LOGGED`. Base do
   * watchdog de demora sem carrinho.
   */
  findDelayCandidates() {
    return this.prisma.orderFicha.findMany({
      where: {
        requestedAt: { not: null },
        lastProposalId: null,
        status: OrderFichaStatus.ORDER_LOGGED,
      },
      select: {
        organizationId: true,
        conversationId: true,
        requestedAt: true,
        divergences: true,
      },
    });
  }

  updateDivergences(
    conversationId: string,
    divergences: Divergence[],
    status: OrderFichaStatus,
    lastProposalId?: string,
  ) {
    return this.prisma.orderFicha.update({
      where: { conversationId },
      data: { divergences: divergences as any, status, lastProposalId },
    });
  }
}
