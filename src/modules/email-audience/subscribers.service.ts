import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EmailSubscriberSource, EmailSubscriberStatus } from '@prisma/client';
import { normalizeEmail, isValidEmail } from '../email-core/email-address.util';
import { SubscribersRepository } from './subscribers.repository';

export interface UpsertSubscriberInput {
  email: string;
  name?: string;
  source: EmailSubscriberSource;
  contactId?: string;
  consentSource?: string;
}

@Injectable()
export class SubscribersService {
  private readonly logger = new Logger(SubscribersService.name);

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

    if (!existing) {
      return this.repo.create({
        organizationId,
        email,
        name: input.name?.trim() || null,
        source: input.source,
        contactId: input.contactId ?? null,
        consentAt: new Date(),
        consentSource: input.consentSource ?? null,
      });
    }

    // Só enriquece o que está vazio: import novo não sobrescreve dado melhor.
    const patch: Record<string, unknown> = {};
    if (!existing.name && input.name?.trim()) patch.name = input.name.trim();
    if (!existing.contactId && input.contactId) patch.contactId = input.contactId;
    if (!existing.consentSource && input.consentSource) patch.consentSource = input.consentSource;
    if (!Object.keys(patch).length) return existing;
    return this.repo.update(existing.id, patch);
  }

  /**
   * `organizationId` é checagem de AUTORIZAÇÃO aqui: quem chama vem de uma
   * rota autenticada por sessão (descadastro manual) ou já resolveu a
   * organização pela própria mensagem (webhook). Sem esse filtro, qualquer
   * usuário autenticado de qualquer organização descadastraria destinatário
   * alheio só sabendo o id.
   */
  async unsubscribe(id: string, organizationId: string, reason: string) {
    const sub = await this.repo.findById(id, organizationId);
    if (!sub) throw new NotFoundException('destinatário não encontrado');
    // Idempotente: repetir o clique não reescreve a data original.
    if (sub.status === EmailSubscriberStatus.UNSUBSCRIBED) return sub;
    return this.repo.update(id, {
      status: EmailSubscriberStatus.UNSUBSCRIBED,
      unsubscribedAt: new Date(),
      suppressedReason: reason,
    });
  }

  /**
   * Usado pelo webhook: bounce permanente e marcação de spam.
   * `organizationId` vem da `EmailMessage` que originou o evento — aqui a
   * checagem não impede um ataque (o webhook não é iniciado pelo usuário),
   * é uma trava de coerência: nunca suprimir um assinante fora da
   * organização da mensagem que gerou o evento.
   */
  async suppress(id: string, organizationId: string, status: EmailSubscriberStatus, reason: string) {
    const sub = await this.repo.findById(id, organizationId);
    if (!sub) {
      this.logger.warn(
        `suppress: assinante ${id} não encontrado na organização ${organizationId} — ignorado`,
      );
      return undefined;
    }
    return this.repo.update(id, { status, suppressedReason: reason });
  }

  /**
   * SEM organização — só para os dois fluxos onde o id já foi validado por
   * outro mecanismo (token de descadastro público; `subscriberId` de uma
   * `EmailMessage` já resolvida por organização no envio de campanha). Ver
   * `SubscribersRepository.findByIdUnscoped`.
   */
  findById(id: string) {
    return this.repo.findByIdUnscoped(id);
  }

  findSendable(organizationId: string) {
    return this.repo.findSendable(organizationId);
  }

  list(organizationId: string, status?: EmailSubscriberStatus, page = 1, limit = 50) {
    return this.repo.list(organizationId, status, (page - 1) * limit, limit);
  }
}
