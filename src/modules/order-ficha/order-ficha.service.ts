import { Injectable, Logger } from '@nestjs/common';
import { OrderRelevanceService } from './order-relevance.service';
import { OrderExtractorService } from './order-extractor.service';
import { OrderFichaRepository } from './order-ficha.repository';
import { ConversationMessagesReader } from './conversation-messages.reader';

export interface IngestInput {
  organizationId: string;
  contactId: string;
  conversationId: string;
  messageId: string;
  text: string;
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
}
