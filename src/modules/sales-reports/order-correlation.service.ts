import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { orderNumberCandidates } from './order-number';
import { phoneDigits } from './reconciliation.match';

/** Pedido do HUB até N dias antes/depois do Ganho conta como "o mesmo negócio". */
const CONTACT_MATCH_WINDOW_DAYS = 7;
/** Só tenta pelo contato em Ganho recente — antigo sem valor fica como está. */
const CONTACT_FALLBACK_LOOKBACK_DAYS = 45;
const PHONE_TAIL_DIGITS = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

type CorrelatedBy = 'order_number' | 'contact';

interface MatchedOrder {
  externalId: string;
  venda: Prisma.Decimal | number | null;
}

interface WonCard {
  id: string;
  value: Prisma.Decimal | number | null;
  closedAt: Date | null;
  metadata: Prisma.JsonValue;
  contact: { phone: string | null; email: string | null } | null;
}

/**
 * E5.2a — Correlação pedido ↔ card Ganho.
 *
 * O atendente marca Ganho e informa o nº do pedido (E5.1), que fica em
 * `Card.metadata.orderNumber`. O HUB sincroniza os pedidos reais em
 * `OfpSalesOrder` (campo `pedido`). Casamos os dois e copiamos o valor real
 * da venda para o card — é esse valor que o Marketing soma por campanha.
 *
 * 1. Pelo nº digitado, tolerante ao texto livre ("Localizador: R4YB7P").
 * 2. Sem nº que case e sem valor no card: pelo telefone/e-mail do contato,
 *    pedido em ±7 dias do Ganho, e só quando sobra exatamente UM pedido
 *    ainda não ligado a outro card. Ambíguo → não chuta.
 *
 * Roda no fim do sync do HUB. Idempotente (pula cards já correlacionados) e
 * best-effort (nunca derruba o sync).
 */
@Injectable()
export class OrderCorrelationService {
  private readonly logger = new Logger(OrderCorrelationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async correlateWonCards(now: Date = new Date()): Promise<{ matched: number; checked: number }> {
    const wonCards: WonCard[] = await this.prisma.card.findMany({
      where: { status: 'WON' },
      select: {
        id: true,
        value: true,
        closedAt: true,
        metadata: true,
        contact: { select: { phone: true, email: true } },
      },
    });

    let matched = 0;
    let checked = 0;
    for (const card of wonCards) {
      const meta = (card.metadata as Record<string, unknown>) ?? {};
      if (meta.ofpOrderExternalId) continue; // já correlacionado → idempotente

      const candidates = orderNumberCandidates(
        typeof meta.orderNumber === 'string' ? meta.orderNumber : null,
      );
      const canTryContact = this.canTryContact(card, now);
      if (candidates.length === 0 && !canTryContact) continue;
      checked++;

      const byNumber = await this.findByOrderNumber(candidates);
      const byContact = !byNumber && canTryContact ? await this.findByContact(card) : null;
      const order = byNumber ?? byContact;
      if (!order) continue;

      await this.linkCard(card, meta, order, byNumber ? 'order_number' : 'contact');
      matched++;
    }

    if (checked > 0) {
      this.logger.log(`correlação HUB: ${matched}/${checked} cards Ganhos casados com pedido`);
    }
    return { matched, checked };
  }

  private canTryContact(card: WonCard, now: Date): boolean {
    if (card.value != null) return false; // já tem valor: não mexe
    if (!card.closedAt) return false;
    if (now.getTime() - card.closedAt.getTime() > CONTACT_FALLBACK_LOOKBACK_DAYS * DAY_MS) return false;
    const hasPhone = phoneDigits(card.contact?.phone).length >= PHONE_TAIL_DIGITS;
    const hasEmail = !!card.contact?.email?.trim();
    return hasPhone || hasEmail;
  }

  /**
   * Pedido já ligado a outro card não liga de novo: dois atendentes que dão
   * Ganho com o mesmo nº (venda em grupo, card duplicado) somariam o valor
   * em dobro no Marketing. Fica no primeiro card.
   */
  private async findByOrderNumber(candidates: string[]): Promise<MatchedOrder | null> {
    if (candidates.length === 0) return null;
    const order = await this.prisma.ofpSalesOrder.findFirst({
      where: { OR: candidates.map((pedido) => ({ pedido: { equals: pedido, mode: 'insensitive' as const } })) },
      select: { externalId: true, venda: true },
    });
    if (!order) return null;
    const alreadyLinked = await this.prisma.card.count({
      where: { metadata: { path: ['ofpOrderExternalId'], equals: order.externalId } },
    });
    return alreadyLinked > 0 ? null : order;
  }

  private async findByContact(card: WonCard): Promise<MatchedOrder | null> {
    const closedAt = card.closedAt as Date;
    const from = new Date(closedAt.getTime() - CONTACT_MATCH_WINDOW_DAYS * DAY_MS);
    const to = new Date(closedAt.getTime() + CONTACT_MATCH_WINDOW_DAYS * DAY_MS);
    const digits = phoneDigits(card.contact?.phone);
    const phoneTail = digits.length >= PHONE_TAIL_DIGITS ? digits.slice(-PHONE_TAIL_DIGITS) : null;
    const email = card.contact?.email?.trim().toLowerCase() || null;

    // Mesmas expressões dos índices `ofp_sales_orders_phone_tail_idx` e
    // `ofp_sales_orders_email_lower_idx`. Valores sempre parametrizados.
    const orders = await this.prisma.$queryRaw<Array<{ external_id: string; venda: Prisma.Decimal | null }>>(
      Prisma.sql`
        SELECT o."external_id", o."venda"
        FROM "ofp_sales_orders" o
        WHERE o."data" >= ${from} AND o."data" <= ${to}
          AND (
            right(regexp_replace(COALESCE(o."telefone_cliente", ''), '[^0-9]', '', 'g'), 8) = ${phoneTail}
            OR lower(TRIM(BOTH FROM COALESCE(o."email_cliente", ''))) = ${email}
          )
          AND NOT EXISTS (
            SELECT 1 FROM "cards" cd
            WHERE cd."metadata"->>'ofpOrderExternalId' = o."external_id"
          )
      `,
    );

    if (orders.length !== 1) return null; // nenhum ou ambíguo → não chuta
    return { externalId: orders[0].external_id, venda: orders[0].venda };
  }

  private async linkCard(
    card: WonCard,
    meta: Record<string, unknown>,
    order: MatchedOrder,
    correlatedBy: CorrelatedBy,
  ): Promise<void> {
    await this.prisma.card.update({
      where: { id: card.id },
      data: {
        metadata: {
          ...meta,
          ofpOrderExternalId: order.externalId,
          correlatedBy,
          correlatedAt: new Date().toISOString(),
        },
        ...(order.venda != null ? { value: order.venda } : {}),
      },
    });
  }
}
