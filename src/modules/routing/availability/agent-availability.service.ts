import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { MessagesService } from '../../messaging/messages/messages.service';
import {
  isWithinHours,
  nextOpenAt,
  previousCloseAt,
  formatReturn,
  type BusinessHoursConfig,
} from './business-hours.util';

export const OFF_HOURS_DEFAULT_TEMPLATE =
  'Oi! No momento o {atendente} está fora do horário de atendimento. ' +
  'Ele retorna {proximo_horario} e responde você assim que possível 🙂';

@Injectable()
export class AgentAvailabilityService {
  private readonly logger = new Logger(AgentAvailabilityService.name);
  // sobrescrito nos testes; produção usa o relógio real
  private clock: () => Date = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
  ) {}

  async onInboundReply(conversationId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        organizationId: true,
        assignedToId: true,
        offHoursNoticeAt: true,
      },
    });
    if (!conversation?.assignedToId) return; // sem humano assumido

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
    if (!membership?.offHoursNoticeEnabled) return;
    const config = (membership.workingHours ?? null) as BusinessHoursConfig | null;
    if (!config) return;

    const org = await this.prisma.organization.findUnique({
      where: { id: conversation.organizationId },
      select: { aiTimezone: true, offHoursMessageTemplate: true },
    });
    const tz = org?.aiTimezone || 'America/Sao_Paulo';
    const now = this.clock();

    if (isWithinHours(config, tz, now)) return; // dentro do horário

    // Dedup: já avisado neste período fechado?
    const closedAt = previousCloseAt(config, tz, now);
    if (
      conversation.offHoursNoticeAt &&
      closedAt &&
      conversation.offHoursNoticeAt >= closedAt
    ) {
      return; // skip
    }

    const firstName = (membership.user?.name ?? '').trim().split(/\s+/)[0] || 'o atendente';
    const nextOpen = nextOpenAt(config, tz, now);
    const proximo = nextOpen ? formatReturn(nextOpen, tz, now) : 'assim que possível';
    const template = org?.offHoursMessageTemplate || OFF_HOURS_DEFAULT_TEMPLATE;
    const text = template
      .replace(/\{atendente\}/g, firstName)
      .replace(/\{proximo_horario\}/g, proximo);

    try {
      await this.messages.send(
        { conversationId: conversation.id, type: 'TEXT', content: { text } } as any,
        conversation.assignedToId,
        conversation.organizationId,
        'ALL',
      );
    } catch (err) {
      this.logger.warn(
        `off_hours_notice_send_failed conv=${conversation.id}: ${(err as Error).message}`,
      );
      return; // não carimba -> tenta de novo no próximo inbound
    }

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { offHoursNoticeAt: now },
    });
  }
}
