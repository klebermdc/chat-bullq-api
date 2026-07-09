import { Injectable } from '@nestjs/common';
import { ConversationSource, Prisma } from '@prisma/client';
import { normalizePhone, phoneMatchSuffix } from '../../../common/utils/phone.util';
import { InboundReferral } from '../../channel-hub/ports/types';

export interface AttributionInput {
  organizationId: string;
  referral?: InboundReferral;
  contactPhone?: string;
}

export interface AttributionResult {
  source: ConversationSource;
  sourceDetail: Prisma.JsonObject;
  matchedLeadIntakeId: string | null;
}

@Injectable()
export class AttributionService {
  /**
   * Resolve a origem de uma conversa NOVA. Prioridade:
   *   1) referral (CTWA)  2) LeadIntake pendente casando telefone  3) ORGANIC.
   * Só lê — a escrita (consumir o LeadIntake, criar a conversa) é do resolver.
   */
  async resolveSource(
    tx: Prisma.TransactionClient,
    input: AttributionInput,
  ): Promise<AttributionResult> {
    // CTWA: o referral só existe na 1ª msg pós-clique. Basta ctwaClid OU sourceId.
    if (input.referral && (input.referral.ctwaClid || input.referral.sourceId)) {
      const r = input.referral;
      return {
        source: ConversationSource.CTWA,
        sourceDetail: {
          sourceType: r.sourceType ?? null,
          adId: r.sourceId ?? null,
          ctwaClid: r.ctwaClid ?? null,
        },
        matchedLeadIntakeId: null,
      };
    }

    if (input.contactPhone) {
      let suffix: string | null = null;
      try {
        suffix = phoneMatchSuffix(normalizePhone(input.contactPhone));
      } catch {
        suffix = null; // telefone impróprio → sem casamento
      }
      if (suffix) {
        const WINDOW_DAYS = 30;
        const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
        const li = await tx.leadIntake.findFirst({
          where: {
            organizationId: input.organizationId,
            consumedAt: null,
            createdAt: { gte: since },
            phoneNormalized: { endsWith: suffix },
          },
          orderBy: { createdAt: 'desc' },
        });
        if (li) {
          return {
            source: li.source,
            sourceDetail: (li.sourceDetail as Prisma.JsonObject) ?? {},
            matchedLeadIntakeId: li.id,
          };
        }
      }
    }

    return { source: ConversationSource.ORGANIC, sourceDetail: {}, matchedLeadIntakeId: null };
  }
}
