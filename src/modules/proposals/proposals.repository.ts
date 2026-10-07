import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ExtractedCart, ProposalDetails, ProposalKind } from './proposals.types';

export interface CreateProposalInput {
  organizationId: string;
  contactId: string;
  conversationId: string;
  checkoutUrl: string;
  createdById: string;
  cart: ExtractedCart;
  rawText: string;
  /** Default PARKS (o que toda proposta era antes dos prints). */
  kind?: ProposalKind;
  /** OTHER: título e linhas; nos dois tipos, os prints enviados. */
  details?: ProposalDetails | null;
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
        kind: input.kind ?? 'PARKS',
        // Sem details = coluna NULL (omitir o campo), igual às propostas antigas.
        details: input.details
          ? (input.details as unknown as Prisma.InputJsonValue)
          : undefined,
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
