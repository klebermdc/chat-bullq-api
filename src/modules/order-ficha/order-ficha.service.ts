import { Injectable, Logger } from '@nestjs/common';
import { OrderFichaStatus } from '@prisma/client';
import { OrderRelevanceService } from './order-relevance.service';
import { OrderExtractorService } from './order-extractor.service';
import { OrderFichaRepository } from './order-ficha.repository';
import { ConversationMessagesReader } from './conversation-messages.reader';
import { DivergenceService } from './divergence.service';
import { OrderAlertService } from './order-alert.service';
import type { ExtractedOrder } from './order-ficha.types';
import type { ExtractedCart } from '../proposals/proposals.types';

export interface IngestInput {
  organizationId: string;
  contactId: string;
  conversationId: string;
  messageId: string;
  text: string;
}

export interface CrossCheckOnProposalInput {
  conversationId: string;
  channelId: string;
  proposalId: string;
  cart: ExtractedCart;
}

/**
 * Orquestrador da Ficha do Pedido: recebe uma mensagem inbound do cliente,
 * decide (gate barato) se ela descreve um pedido, e se sim roda o extrator
 * (grounded, contexto das últimas mensagens) e faz upsert da ficha.
 *
 * Fail-open por design nos serviços que injeta (relevance/extractor já são
 * fail-closed/fail-empty internamente) — qualquer erro deles não deve
 * derrubar o job; quem chama (o processor) trata a exceção.
 */
@Injectable()
export class OrderFichaService {
  private readonly logger = new Logger(OrderFichaService.name);

  constructor(
    private readonly relevance: OrderRelevanceService,
    private readonly extractor: OrderExtractorService,
    private readonly repo: OrderFichaRepository,
    private readonly messages: ConversationMessagesReader,
    private readonly divergence: DivergenceService,
    private readonly alert: OrderAlertService,
  ) {}

  async ingestMessage(input: IngestInput): Promise<void> {
    if (!input.text?.trim()) return;

    const isOrder = await this.relevance.isOrderMessage(input.text, input.organizationId);
    if (!isOrder) return;

    const recent = await this.messages.recentCustomerTexts(input.conversationId, 15);
    const extracted = await this.extractor.extract(
      recent.length ? recent : [input.text],
      input.organizationId,
    );

    if (extracted.items.length === 0) return;

    await this.repo.upsertOrder({
      organizationId: input.organizationId,
      contactId: input.contactId,
      conversationId: input.conversationId,
      items: extracted.items,
      travelDatesText: extracted.travelDatesText,
      travelStart: extracted.travelStart ? new Date(extracted.travelStart) : null,
      travelEnd: extracted.travelEnd ? new Date(extracted.travelEnd) : null,
      requestedAt: new Date(),
      sourceMessageId: input.messageId,
    });
  }

  /**
   * Cruzamento executado quando o atendente envia uma proposta (carrinho) ao
   * cliente: compara o que a Ficha registrou (extraído das mensagens do
   * cliente) com o carrinho realmente montado no HUB. Se houver divergência,
   * grava o status e dispara o alerta SYSTEM na conversa.
   *
   * Fire-and-forget do ponto de vista de quem chama (ProposalsService) — não
   * deve nunca bloquear/derrubar o envio da proposta.
   */
  async crossCheckOnProposal(input: CrossCheckOnProposalInput): Promise<void> {
    const ficha = await this.repo.findByConversation(input.conversationId);
    if (!ficha) return;

    const order: ExtractedOrder = {
      items: (ficha.items as any) ?? [],
      travelStart: ficha.travelStart ? new Date(ficha.travelStart).toISOString() : null,
      travelEnd: ficha.travelEnd ? new Date(ficha.travelEnd).toISOString() : null,
      travelDatesText: ficha.travelDatesText ?? null,
    };

    const divergences = this.divergence.compare(order, input.cart);
    const status = divergences.length > 0 ? OrderFichaStatus.DIVERGENT : OrderFichaStatus.MATCHED;

    await this.repo.updateDivergences(input.conversationId, divergences, status, input.proposalId);
    await this.alert.raise(input.conversationId, input.channelId, divergences);
  }
}
