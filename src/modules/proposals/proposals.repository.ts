import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ExtractedCart } from './proposals.types';

export interface CreateProposalInput {
  organizationId: string;
  contactId: string;
  conversationId: string;
  checkoutUrl: string;
  createdById: string;
  cart: ExtractedCart;
  rawText: string;
}

@Injectable()
export class ProposalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateProposalInput) {
    const { cart } = input;
    return this.prisma.proposal.create({
      data: {
        organizationId: input.organizationId,
        contactId: input.contactId,
        conversationId: input.conversationId,
        checkoutUrl: input.checkoutUrl,
        adults: cart.adults,
        children: cart.children,
        startDate: new Date(cart.startDate),
        endDate: new Date(cart.endDate),
        parks: cart.parks as unknown as Prisma.InputJsonValue,
        totalValue: cart.totalValue,
        currency: cart.currency,
        rawText: input.rawText,
        createdById: input.createdById,
      },
    });
  }

  listForContact(organizationId: string, contactId: string) {
    return this.prisma.proposal.findMany({
      where: { organizationId, contactId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
