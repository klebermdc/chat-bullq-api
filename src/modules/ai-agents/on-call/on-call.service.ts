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
import {
  formatHolidayReturn,
  holidayReturnAt,
  isHolidayActive,
} from '../../routing/availability/holiday.util';
import { EMERGENCY_CONTACT_TOOL } from '../emergency/emergency-contact.util';

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/**
 * Ferramentas da Aline de plantão: responder, deixar recado, abrir chamado e
 * o canal de urgência. Ela avisa que o vendedor está fora e faz a triagem;
 * não consulta produto nem pedido.
 */
export const ON_CALL_TOOLS: ReadonlySet<string> = new Set([
  'replyToConversation',
  'leaveNoteForSeller',
  'openSupportTicket',
  EMERGENCY_CONTACT_TOOL,
]);

/** Ferramenta que só existe no plantão (fora dele, a Aline não deixa recado). */
export const ON_CALL_ONLY_TOOL = 'leaveNoteForSeller';

export interface OnCallContext {
  /** Primeiro nome do vendedor da conversa. */
  sellerName: string;
  /** Quando ele volta, já formatado ("amanhã às 9h"). */
  returnAt: string;
  /** Agência em feriado: a equipe toda está parada, não só o vendedor. */
  isHoliday?: boolean;
}

type OnCallConversation = Pick<
  Conversation,
  'id' | 'organizationId' | 'assignedToId' | 'lastHumanReplyAt'
>;

/**
 * Aline de plantão: a conversa tem vendedor, ele está fora do próprio horário
 * e ninguém da equipe respondeu desde que ele saiu. Aí a Aline atende no
 * lugar dele, em modo restrito (avisa e faz a triagem de emergência), até
 * ele voltar ou um humano responder.
 *
 * Liga por vendedor com o mesmo interruptor do aviso de fora do horário
 * (`UserOrganization.offHoursNoticeEnabled`) e usa o horário dele.
 * No feriado da agência (`aiHolidayUntil`) cobre todo vendedor, sem interruptor.
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
    const org = await this.prisma.organization.findUnique({
      where: { id: conversation.organizationId },
      select: {
        aiTimezone: true,
        aiBusinessHours: true,
        aiHolidayUntil: true,
        aiHolidayStartedAt: true,
      },
    });
    const tz = org?.aiTimezone || DEFAULT_TIMEZONE;
    const now = this.clock();
    const sellerHours = (membership?.workingHours ?? null) as BusinessHoursConfig | null;
    const sellerName =
      (membership?.user?.name ?? '').trim().split(/\s+/)[0] || 'o seu atendente';

    // Feriado: cobre todo vendedor, com ou sem plantão ligado, até um humano
    // responder depois que o feriado começou.
    if (org?.aiHolidayUntil && isHolidayActive(org.aiHolidayUntil, now)) {
      const startedAt = org.aiHolidayStartedAt;
      if (conversation.lastHumanReplyAt && startedAt && conversation.lastHumanReplyAt >= startedAt) {
        return null;
      }
      const hours = sellerHours ?? ((org.aiBusinessHours ?? null) as BusinessHoursConfig | null);
      const back = holidayReturnAt(hours, tz, org.aiHolidayUntil);
      return { sellerName, returnAt: formatHolidayReturn(back, tz, now), isHoliday: true };
    }

    if (!membership?.offHoursNoticeEnabled) return null;
    if (!sellerHours) return null;
    if (isWithinHours(sellerHours, tz, now)) return null;
    // Agenda sem nenhum dia aberto: não há volta para anunciar.
    const nextOpen = nextOpenAt(sellerHours, tz, now);
    if (!nextOpen) return null;

    // Humano respondeu depois que o vendedor saiu: ele manda até o próximo
    // período fechado.
    const closedAt = previousCloseAt(sellerHours, tz, now);
    if (conversation.lastHumanReplyAt && closedAt && conversation.lastHumanReplyAt >= closedAt) {
      return null;
    }

    return { sellerName, returnAt: formatReturn(nextOpen, tz, now) };
  }
}
