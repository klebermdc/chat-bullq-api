import { Injectable } from '@nestjs/common';
import { Prisma, Proposal } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { ExtractedCart, ProposalDetails, ProposalKind } from './proposals.types';
import { QUOTE_KIND, QUOTE_NUMBER_ATTEMPTS } from './quote/quote.constants';
import type { QuoteData } from './quote/quote.types';

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
  /** QUOTE: token da página pública e validade. */
  publicToken?: string;
  expiresAt?: Date;
}

/** Nova versão de uma cotação conferida pelo atendente. */
export interface QuoteUpdateInput {
  quote: QuoteData;
  customerName: string | null;
  cart: ExtractedCart;
  expiresAt: Date;
  editedById: string;
  now: Date;
}

const UNIQUE_VIOLATION = 'P2002';

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === UNIQUE_VIOLATION;

/** Colunas do carrinho (iguais na criação e na atualização da cotação). */
function cartColumns(cart: ExtractedCart) {
  return {
    adults: cart.adults,
    children: cart.children,
    startDate: new Date(cart.startDate),
    endDate: new Date(cart.endDate),
    parks: cart.parks as unknown as Prisma.InputJsonValue,
    totalValue: cart.totalValue,
    currency: cart.currency,
  };
}

@Injectable()
export class ProposalsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateProposalInput) {
    const data: Prisma.ProposalUncheckedCreateInput = {
      organizationId: input.organizationId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      checkoutUrl: input.checkoutUrl,
      ...cartColumns(input.cart),
      rawText: input.rawText,
      createdById: input.createdById,
      kind: input.kind ?? 'PARKS',
      // Sem details = coluna NULL (omitir o campo), igual às propostas antigas.
      details: input.details
        ? (input.details as unknown as Prisma.InputJsonValue)
        : undefined,
      publicToken: input.publicToken,
      expiresAt: input.expiresAt,
    };
    if (data.kind !== QUOTE_KIND) return this.prisma.proposal.create({ data });
    return this.createNumberedQuote(data);
  }

  /**
   * Cotação ganha o próximo número da organização. Duas gravadas ao mesmo
   * tempo podem pegar o mesmo; o índice único barra a segunda, que tenta de novo.
   */
  private async createNumberedQuote(data: Prisma.ProposalUncheckedCreateInput): Promise<Proposal> {
    for (let attempt = 1; ; attempt++) {
      const last = await this.prisma.proposal.aggregate({
        where: { organizationId: data.organizationId },
        _max: { quoteNumber: true },
      });
      try {
        return await this.prisma.proposal.create({ data: { ...data, quoteNumber: (last._max.quoteNumber ?? 0) + 1 } });
      } catch (err) {
        if (!isUniqueViolation(err) || attempt >= QUOTE_NUMBER_ATTEMPTS) throw err;
      }
    }
  }

  /**
   * Troca a cotação pela versão conferida e guarda a anterior em
   * `proposal_versions`. Só grava se ninguém atualizou depois de `current`
   * ser lida; senão devolve null (o atendente abre de novo e confere).
   */
  updateQuote(current: Proposal, change: QuoteUpdateInput): Promise<Proposal | null> {
    const previous = (current.details ?? {}) as Record<string, unknown>;
    const details = { ...previous, quote: change.quote, customerName: change.customerName };
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.proposal.updateMany({
        where: { id: current.id, quoteVersion: current.quoteVersion },
        data: {
          ...cartColumns(change.cart),
          details: details as unknown as Prisma.InputJsonValue,
          expiresAt: change.expiresAt,
          quoteVersion: current.quoteVersion + 1,
          quoteUpdatedAt: change.now,
        },
      });
      if (count === 0) return null;
      await tx.proposalVersion.create({
        data: {
          proposalId: current.id,
          version: current.quoteVersion,
          details: previous as unknown as Prisma.InputJsonValue,
          totalValue: current.totalValue,
          expiresAt: current.expiresAt,
          replacedById: change.editedById,
          replacedAt: change.now,
        },
      });
      return tx.proposal.findUnique({ where: { id: current.id } });
    });
  }

  listForContact(organizationId: string, contactId: string) {
    return this.prisma.proposal.findMany({
      where: { organizationId, contactId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
