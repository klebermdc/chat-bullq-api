import { BadRequestException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { QUOTE_COMPANY } from '../quote-company';
import { QUOTE_TERMS } from '../quote-terms';
import { QuotePdfService } from './quote-pdf';
import { quotePublicUrl } from './quote-proposal';
import { quoteCode, quoteStatus, toPublicQuote } from './quote-public';
import { QUOTE_KIND, QUOTE_TOKEN_RE } from './quote.constants';
import type { PublicQuoteView, QuoteData } from './quote.types';
import { SellerWhatsappService } from './seller-whatsapp.service';

const NOT_FOUND = 'Cotação não encontrada ou link inválido';
const EXPIRED = 'Esta cotação venceu. Fale com o vendedor para atualizar os valores.';

export function checkQuoteToken(token: unknown): string {
  if (typeof token !== 'string' || !QUOTE_TOKEN_RE.test(token)) throw new BadRequestException('Link inválido');
  return token;
}

const QUOTE_SELECT = {
  id: true,
  kind: true,
  details: true,
  createdAt: true,
  expiresAt: true,
  createdById: true,
  conversationId: true,
} as const;

interface LoadedQuote {
  id: string;
  createdAt: Date;
  expiresAt: Date | null;
  createdById: string;
  conversationId: string;
  quote: QuoteData;
  customerName: string | null;
}

/**
 * Página pública da cotação (sem login). O token é o único fator de acesso e
 * só abre aquela cotação; a resposta é montada campo a campo, sem ids internos
 * nem dados do cliente além do nome que o atendente escolheu.
 */
@Injectable()
export class PublicQuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seller: SellerWhatsappService,
    private readonly pdfService: QuotePdfService,
  ) {}

  async view(token: string): Promise<PublicQuoteView> {
    return this.toView(await this.load(token), new Date());
  }

  /** Abertura pela página no navegador do cliente. */
  async markViewed(token: string): Promise<{ ok: true }> {
    const { id } = await this.load(token);
    const now = new Date();
    await this.prisma.proposal.update({
      where: { id },
      data: { viewCount: { increment: 1 }, lastViewedAt: now },
    });
    await this.prisma.proposal.updateMany({
      where: { id, firstViewedAt: null },
      data: { firstViewedAt: now },
    });
    return { ok: true };
  }

  async pdf(token: string): Promise<{ buffer: Buffer; filename: string }> {
    const loaded = await this.load(token);
    const now = new Date();
    if (quoteStatus(loaded.expiresAt, now) === 'EXPIRED') throw new GoneException(EXPIRED);
    const view = await this.toView(loaded, now);
    const buffer = await this.pdfService.render(view, quotePublicUrl(token));
    return { buffer, filename: `cotacao-${view.code}.pdf` };
  }

  private async load(token: string): Promise<LoadedQuote> {
    const row = await this.prisma.proposal.findUnique({ where: { publicToken: token }, select: QUOTE_SELECT });
    if (!row || row.kind !== QUOTE_KIND) throw new NotFoundException(NOT_FOUND);
    const details = (row.details ?? {}) as Record<string, unknown>;
    const quote = toPublicQuote(details.quote);
    if (!quote) throw new NotFoundException(NOT_FOUND);
    const customerName = typeof details.customerName === 'string' && details.customerName ? details.customerName : null;
    return { ...row, quote, customerName };
  }

  private async toView(q: LoadedQuote, now: Date): Promise<PublicQuoteView> {
    const [sellerName, whatsapp] = await Promise.all([this.sellerName(q.createdById), this.sellerWhatsapp(q.conversationId)]);
    return {
      status: quoteStatus(q.expiresAt, now),
      code: quoteCode(q.id),
      customerName: q.customerName,
      seller: { name: sellerName, whatsapp },
      createdAt: q.createdAt.toISOString(),
      expiresAt: (q.expiresAt ?? q.createdAt).toISOString(),
      quote: q.quote,
      company: { ...QUOTE_COMPANY },
      terms: QUOTE_TERMS,
    };
  }

  /** Vendedor removido: a página fala em nome da empresa. */
  private async sellerName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return user?.name?.trim() || QUOTE_COMPANY.name;
  }

  private async sellerWhatsapp(conversationId: string): Promise<string | null> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { channel: { select: { id: true, type: true, config: true } } },
    });
    return this.seller.resolve(conversation?.channel ?? null);
  }
}
