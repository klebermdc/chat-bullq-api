import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EmailSubscriberSource, EmailSubscriberStatus } from '@prisma/client';
import { normalizeEmail, isValidEmail } from '../email-core/email-address.util';
import { SubscribersRepository } from './subscribers.repository';

/**
 * Campos derivados de pedidos do HUB. Ao contrário de `name`/`contactId`,
 * que só preenchem quando vazios, estes SEMPRE sobrescrevem: manter o valor
 * antigo (uma contagem ou um total desatualizado) é pior que não ter.
 */
export interface PurchaseEnrichment {
  firstPurchaseAt: Date | null;
  lastPurchaseAt: Date | null;
  totalSpent: number;
  orderCount: number;
  categories: string[];
  suppliers: string[];
}

export interface UpsertSubscriberInput {
  email: string;
  name?: string;
  source: EmailSubscriberSource;
  contactId?: string;
  consentSource?: string;
  enrichment?: PurchaseEnrichment;
}

@Injectable()
export class SubscribersService {
  constructor(private readonly repo: SubscribersRepository) {}

  /**
   * Entrada única da base: as quatro fontes desaguam aqui e o dedupe é pelo
   * endereço normalizado.
   *
   * Regra que não pode quebrar: quem saiu da lista NUNCA volta por importação.
   * Por isso `status` jamais aparece no patch abaixo.
   */
  async upsert(organizationId: string, input: UpsertSubscriberInput) {
    if (!isValidEmail(input.email)) {
      throw new BadRequestException(`endereço inválido: "${input.email}"`);
    }
    const email = normalizeEmail(input.email)!;
    const existing = await this.repo.findByEmail(organizationId, email);

    // Sempre recalculado quando presente — nunca "só se vazio". `status`
    // jamais entra aqui: enriquecer não pode ressuscitar quem descadastrou.
    const enrichmentPatch = input.enrichment
      ? {
          firstPurchaseAt: input.enrichment.firstPurchaseAt,
          lastPurchaseAt: input.enrichment.lastPurchaseAt,
          totalSpent: input.enrichment.totalSpent,
          orderCount: input.enrichment.orderCount,
          categories: input.enrichment.categories,
          suppliers: input.enrichment.suppliers,
          enrichedAt: new Date(),
        }
      : {};

    if (!existing) {
      return this.repo.create({
        organizationId,
        email,
        name: input.name?.trim() || null,
        source: input.source,
        contactId: input.contactId ?? null,
        consentAt: new Date(),
        consentSource: input.consentSource ?? null,
        ...enrichmentPatch,
      });
    }

    // Só enriquece o que está vazio: import novo não sobrescreve dado melhor.
    const patch: Record<string, unknown> = { ...enrichmentPatch };
    if (!existing.name && input.name?.trim()) patch.name = input.name.trim();
    if (!existing.contactId && input.contactId) patch.contactId = input.contactId;
    if (!existing.consentSource && input.consentSource) patch.consentSource = input.consentSource;
    if (!Object.keys(patch).length) return existing;
    return this.repo.update(existing.id, patch);
  }

  async unsubscribe(id: string, reason: string) {
    const sub = await this.repo.findById(id);
    if (!sub) throw new NotFoundException('destinatário não encontrado');
    // Idempotente: repetir o clique não reescreve a data original.
    if (sub.status === EmailSubscriberStatus.UNSUBSCRIBED) return sub;
    return this.repo.update(id, {
      status: EmailSubscriberStatus.UNSUBSCRIBED,
      unsubscribedAt: new Date(),
      suppressedReason: reason,
    });
  }

  /** Usado pelo webhook: bounce permanente e marcação de spam. */
  suppress(id: string, status: EmailSubscriberStatus, reason: string) {
    return this.repo.update(id, { status, suppressedReason: reason });
  }

  findById(id: string) {
    return this.repo.findById(id);
  }

  findSendable(organizationId: string) {
    return this.repo.findSendable(organizationId);
  }

  list(organizationId: string, status?: EmailSubscriberStatus, page = 1, limit = 50) {
    return this.repo.list(organizationId, status, (page - 1) * limit, limit);
  }
}
