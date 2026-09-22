import { Injectable } from '@nestjs/common';
import { Conversation } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import {
  formatReturn,
  isWithinHours,
  nextOpenAt,
  previousCloseAt,
  type BusinessHoursConfig,
} from '../../routing/availability/business-hours.util';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/** Ferramentas da Aline de plantão: responder, consultar e deixar recado. */
export const ON_CALL_TOOLS: ReadonlySet<string> = new Set([
  'replyToConversation',
  'lookupOffering',
  'checkPurchase',
  'leaveNoteForSeller',
]);

/** Ferramenta que só existe no plantão (fora dele, a Aline não deixa recado). */
export const ON_CALL_ONLY_TOOL = 'leaveNoteForSeller';

export interface OnCallContext {
  /** Primeiro nome do vendedor da conversa. */
  sellerName: string;
  /** Quando ele volta, já formatado ("amanhã às 9h"). */
  returnAt: string;
}

type OnCallConversation = Pick<
  Conversation,
  'id' | 'organizationId' | 'assignedToId' | 'lastHumanReplyAt'
>;

/**
 * Aline de plantão: a conversa tem vendedor, ele está fora do próprio horário
 * e ninguém da equipe respondeu desde que ele saiu. Aí a Aline atende no
 * lugar dele, em modo restrito, até ele voltar ou um humano responder.
 *
 * Liga por vendedor com o mesmo interruptor do aviso de fora do horário
 * (`UserOrganization.offHoursNoticeEnabled`) e usa o horário dele.
 */
@Injectable()
export class OnCallService {
  // sobrescrito nos testes; produção usa o relógio real
  private clock: () => Date = () => new Date();

  constructor(private readonly prisma: PrismaService) {}

  async evaluate(conversation: OnCallConversation): Promise<OnCallContext | null> {
    if (!conversation.assignedToId) return null;

    const membership = await this.prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: conversation.assignedToId,
          organizationId: conversation.organizationId,
        },
      },
      select: {
        workingHours: true,
        offHoursNoticeEnabled: true,
        user: { select: { name: true } },
      },
    });
    if (!membership?.offHoursNoticeEnabled) return null;
    const hours = (membership.workingHours ?? null) as BusinessHoursConfig | null;
    if (!hours) return null;

    const org = await this.prisma.organization.findUnique({
      where: { id: conversation.organizationId },
      select: { aiTimezone: true },
    });
    const tz = org?.aiTimezone || DEFAULT_TIMEZONE;
    const now = this.clock();

    if (isWithinHours(hours, tz, now)) return null;
    // Agenda sem nenhum dia aberto: não há volta para anunciar.
    const nextOpen = nextOpenAt(hours, tz, now);
    if (!nextOpen) return null;

    // Humano respondeu depois que o vendedor saiu: ele manda até o próximo
    // período fechado.
    const closedAt = previousCloseAt(hours, tz, now);
    if (conversation.lastHumanReplyAt && closedAt && conversation.lastHumanReplyAt >= closedAt) {
      return null;
    }

    const sellerName = (membership.user?.name ?? '').trim().split(/\s+/)[0] || 'o seu atendente';
    return { sellerName, returnAt: formatReturn(nextOpen, tz, now) };
  }
}
