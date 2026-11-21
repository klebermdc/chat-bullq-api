import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { NOT_LOST_RECOVERY } from '../pipelines/lost-recovery.constants';
import { ReconciliationService } from './reconciliation.service';
import { contactKeys, ContactKeys, findContactsByKeys, hasContactKeys, MatchedContact } from './hub-order.contacts';
import {
  decideOrderWon,
  HubCard,
  LOOKUP_WON_LOOKBACK_DAYS,
  pickLookupCard,
  WON_MATCH_WINDOW_DAYS,
} from './hub-order.decision';
import { HubOrderInput, hubOrderToRow, parseHubDate } from './hub-order.row';

const DAY_MS = 24 * 60 * 60 * 1000;

const PERSON = { select: { name: true, email: true } } as const;
const CARD_SELECT = {
  id: true,
  title: true,
  status: true,
  value: true,
  closedAt: true,
  updatedAt: true,
  metadata: true,
  contactId: true,
  assignedTo: PERSON,
  conversation: { select: { assignedTo: PERSON } },
} satisfies Prisma.CardSelect;

type CardRow = Prisma.CardGetPayload<{ select: typeof CARD_SELECT }>;

export interface PublicSeller {
  name: string;
  email: string;
}

export interface OrderLookupResult {
  contact: MatchedContact | null;
  card: { id: string; title: string; status: string; value: number } | null;
  seller: PublicSeller | null;
  openCards: number;
}

export type OrderWonResultCode = 'won' | 'linked_existing' | 'already_linked' | 'no_contact' | 'no_card' | 'ambiguous';

export interface OrderWonResult {
  result: OrderWonResultCode;
  cardId: string | null;
  contact: MatchedContact | null;
  seller: PublicSeller | null;
  candidates: number;
}

const toNumber = (v: Prisma.Decimal | null): number | null => (v == null ? null : Number(v));
const metaString = (meta: Prisma.JsonValue, key: string): string | null => {
  const value = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta[key] : null;
  return typeof value === 'string' && value.trim() ? value : null;
};

function sellerOf(card: CardRow): PublicSeller | null {
  const person = card.assignedTo ?? card.conversation?.assignedTo ?? null;
  return person ? { name: person.name, email: person.email } : null;
}

function toHubCard(card: CardRow): HubCard {
  return {
    id: card.id,
    status: card.status,
    value: toNumber(card.value),
    closedAt: card.closedAt,
    updatedAt: card.updatedAt,
    orderNumber: metaString(card.metadata, 'orderNumber'),
    ofpOrderExternalId: metaString(card.metadata, 'ofpOrderExternalId'),
    sellerName: sellerOf(card)?.name ?? null,
  };
}

/**
 * Integração OFP Hub → Sendtur (API pública).
 *
 * - `lookup`: o Hub mostra no pedido qual card/vendedor o cliente tem aqui.
 * - `markWon`: o Hub avisa que o pedido foi salvo; ligamos o pedido ao card e
 *   fechamos em Ganho. Nunca cria contato nem card. Idempotente (o Hub
 *   retenta). Tudo restrito à org da chave `pk_`.
 */
@Injectable()
export class HubOrderService {
  private readonly logger = new Logger(HubOrderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  async lookup(
    organizationId: string,
    query: { email?: string | null; phone?: string | null },
    now: Date = new Date(),
  ): Promise<OrderLookupResult> {
    const keys = contactKeys(query.email, query.phone);
    if (!hasContactKeys(keys)) {
      throw new BadRequestException('Informe email ou phone (com ao menos 8 dígitos).');
    }
    const contacts = await findContactsByKeys(this.prisma, organizationId, keys);
    if (contacts.length === 0) return { contact: null, card: null, seller: null, openCards: 0 };

    const since = new Date(now.getTime() - LOOKUP_WON_LOOKBACK_DAYS * DAY_MS);
    const cards = await this.loadCards(organizationId, contacts, since);
    const picked = pickLookupCard(cards.map(toHubCard), now);
    const row = picked ? cards.find((c) => c.id === picked.id) ?? null : null;

    return {
      contact: this.contactFor(row, contacts),
      card: row
        ? { id: row.id, title: row.title, status: row.status, value: toNumber(row.value) ?? 0 }
        : null,
      seller: row ? sellerOf(row) : null,
      openCards: cards.filter((c) => c.status === 'OPEN').length,
    };
  }

  async markWon(organizationId: string, input: HubOrderInput): Promise<OrderWonResult> {
    const parsed = parseHubDate(input.data);
    if (!parsed) throw new BadRequestException('data inválida (use aaaa-mm-dd).');

    const linked = await this.findLinkedCard(organizationId, input.externalId);
    if (linked) {
      return this.result('already_linked', linked, await this.contactsOf(organizationId, linked), 0);
    }

    await this.upsertOrder(input, parsed);

    const keys: ContactKeys = contactKeys(input.email, input.telefone);
    const contacts = await findContactsByKeys(this.prisma, organizationId, keys);
    if (contacts.length === 0) return this.result('no_contact', null, [], 0);

    const since = new Date(parsed.data.getTime() - WON_MATCH_WINDOW_DAYS * DAY_MS);
    const cards = await this.loadCards(organizationId, contacts, since);
    const decision = decideOrderWon(cards.map(toHubCard), {
      pedido: input.pedido,
      venda: input.venda,
      vendedor: input.vendedor,
      data: parsed.data,
    });

    if (decision.result === 'no_card' || decision.result === 'ambiguous') {
      return this.result(decision.result, null, contacts, decision.candidates);
    }

    const card = cards.find((c) => c.id === decision.card.id) as CardRow;
    await this.reconciliation.link(input.externalId, card.id, organizationId, {
      moveToWon: decision.result === 'won',
      // O Hub já manda o Purchase dele pra Meta ao salvar o pedido.
      skipCapi: true,
    });
    this.logger.log(`hub: pedido ${input.externalId} → card ${card.id} (${decision.result})`);
    return this.result(decision.result, card, contacts, decision.candidates);
  }

  private result(
    result: OrderWonResultCode,
    card: CardRow | null,
    contacts: MatchedContact[],
    candidates: number,
  ): OrderWonResult {
    return {
      result,
      cardId: card?.id ?? null,
      contact: this.contactFor(card, contacts),
      seller: card ? sellerOf(card) : null,
      candidates,
    };
  }

  /** Contato do card escolhido; sem card, o contato que melhor casou. */
  private contactFor(card: Pick<CardRow, 'contactId'> | null, contacts: MatchedContact[]): MatchedContact | null {
    const own = card?.contactId ? contacts.find((c) => c.id === card.contactId) : undefined;
    return own ?? contacts[0] ?? null;
  }

  private loadCards(organizationId: string, contacts: MatchedContact[], wonSince: Date): Promise<CardRow[]> {
    return this.prisma.card.findMany({
      where: {
        organizationId,
        contactId: { in: contacts.map((c) => c.id) },
        ...NOT_LOST_RECOVERY,
        OR: [{ status: 'OPEN' }, { status: 'WON', closedAt: { gte: wonSince } }],
      },
      select: CARD_SELECT,
    });
  }

  private findLinkedCard(organizationId: string, externalId: string): Promise<CardRow | null> {
    return this.prisma.card.findFirst({
      where: { organizationId, metadata: { path: ['ofpOrderExternalId'], equals: externalId } },
      select: CARD_SELECT,
    });
  }

  private async contactsOf(organizationId: string, card: CardRow): Promise<MatchedContact[]> {
    if (!card.contactId) return [];
    const contact = await this.prisma.contact.findFirst({
      where: { id: card.contactId, organizationId },
      select: { id: true, name: true, email: true, phone: true },
    });
    return contact ? [contact] : [];
  }

  /** Mesma chave do sync periódico (`externalId`) → o pull seguinte não duplica. */
  private async upsertOrder(input: HubOrderInput, parsed: { data: Date; dataRaw: string }): Promise<void> {
    const row = hubOrderToRow(input, parsed);
    await this.prisma.ofpSalesOrder.upsert({
      where: { externalId: input.externalId },
      create: { externalId: input.externalId, ...row },
      update: row,
    });
  }
}
