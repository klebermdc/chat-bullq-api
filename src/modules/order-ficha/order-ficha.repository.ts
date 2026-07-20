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
