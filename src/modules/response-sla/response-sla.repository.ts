import { Injectable } from '@nestjs/common';
import { AgentStatus, ConversationStatus, OrgRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  DEFAULT_TIMEZONE,
  isWaitingForHuman,
  parseResponseSlaMinutes,
  resolveHours,
  toHoursConfig,
} from './response-sla.rules';
import type { EndReason, SlaContext, SlaRecord } from './response-sla.types';

const RECORD_SELECT = {
  id: true,
  organizationId: true,
  conversationId: true,
  agentId: true,
  slaMinutes: true,
  waitingSince: true,
  dueAt: true,
  warnedAt: true,
  breached: true,
  respondedAt: true,
  endedAt: true,
} satisfies Prisma.ResponseSlaRecordSelect;

const OPEN = { respondedAt: null, endedAt: null } as const;

export interface NewRecord {
  organizationId: string;
  conversationId: string;
  agentId: string | null;
  slaMinutes: number;
  waitingSince: Date;
  dueAt: Date | null;
}

export interface AnsweredClose {
  respondedAt: Date;
  businessMinutes: number;
  breached: boolean;
  agentId: string | null;
}

/** Acesso a banco do SLA de resposta. Sem regra de negócio aqui. */
@Injectable()
export class ResponseSlaRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadContext(conversationId: string): Promise<SlaContext | null> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        organizationId: true,
        assignedToId: true,
        awaitingHumanReply: true,
        status: true,
        deletedAt: true,
        isArchived: true,
        contact: { select: { name: true, phone: true } },
        organization: {
          select: { settings: true, aiTimezone: true, aiBusinessHours: true },
        },
      },
    });
    if (!conv) return null;

    const agentHours = conv.assignedToId
      ? await this.agentHours(conv.assignedToId, conv.organizationId)
      : null;

    return {
      conversationId: conv.id,
      organizationId: conv.organizationId,
      assignedToId: conv.assignedToId,
      contactName: conv.contact?.name || conv.contact?.phone || 'Cliente',
      isWaiting: isWaitingForHuman(conv),
      slaMinutes: parseResponseSlaMinutes(conv.organization.settings),
      tz: conv.organization.aiTimezone || DEFAULT_TIMEZONE,
      hours: resolveHours(agentHours, toHoursConfig(conv.organization.aiBusinessHours)),
    };
  }

  findOpenRecord(conversationId: string): Promise<SlaRecord | null> {
    return this.prisma.responseSlaRecord.findFirst({
      where: { conversationId, ...OPEN },
      select: RECORD_SELECT,
    });
  }

  findRecord(id: string): Promise<SlaRecord | null> {
    return this.prisma.responseSlaRecord.findUnique({
      where: { id },
      select: RECORD_SELECT,
    });
  }

  /** null quando outra chamada abriu a espera primeiro (índice único parcial). */
  async createRecord(data: NewRecord): Promise<SlaRecord | null> {
    try {
      return await this.prisma.responseSlaRecord.create({ data, select: RECORD_SELECT });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return null;
      }
      throw err;
    }
  }

  async updatePlan(id: string, data: { agentId: string | null; dueAt: Date | null }): Promise<void> {
    await this.prisma.responseSlaRecord.updateMany({ where: { id, ...OPEN }, data });
  }

  /** Marca o aviso uma única vez. true = esta chamada ganhou e deve notificar. */
  async claimWarn(id: string, at: Date): Promise<boolean> {
    const res = await this.prisma.responseSlaRecord.updateMany({
      where: { id, ...OPEN, warnedAt: null, breached: false },
      data: { warnedAt: at },
    });
    return res.count > 0;
  }

  /** Marca o estouro uma única vez. true = esta chamada ganhou e deve notificar. */
  async claimBreach(id: string, at: Date): Promise<boolean> {
    const res = await this.prisma.responseSlaRecord.updateMany({
      where: { id, ...OPEN, breached: false },
      data: { breached: true, breachedAt: at },
    });
    return res.count > 0;
  }

  async closeAnswered(id: string, data: AnsweredClose): Promise<void> {
    await this.prisma.responseSlaRecord.updateMany({ where: { id, ...OPEN }, data });
  }

  async closeEnded(id: string, reason: EndReason, at: Date): Promise<void> {
    await this.prisma.responseSlaRecord.updateMany({
      where: { id, ...OPEN },
      data: { endedAt: at, endReason: reason },
    });
  }

  /**
   * Esperas abertas cuja conversa já saiu do Esperando (fechamento automático
   * por SQL, lead do site, falha de gancho). Lote limitado por rodada.
   */
  findStaleOpenRecords(
    limit: number,
  ): Promise<Array<{ id: string; conversationId: string; lastHumanReplyAt: Date | null; waitingSince: Date }>> {
    return this.prisma.responseSlaRecord
      .findMany({
        where: {
          ...OPEN,
          conversation: {
            OR: [
              { awaitingHumanReply: false },
              { status: ConversationStatus.CLOSED },
              { deletedAt: { not: null } },
              { isArchived: true },
            ],
          },
        },
        select: {
          id: true,
          conversationId: true,
          waitingSince: true,
          conversation: { select: { lastHumanReplyAt: true } },
        },
        take: limit,
      })
      .then((rows) =>
        rows.map((r) => ({
          id: r.id,
          conversationId: r.conversationId,
          waitingSince: r.waitingSince,
          lastHumanReplyAt: r.conversation.lastHumanReplyAt,
        })),
      );
  }

  listOnlineMembers(organizationId: string): Promise<Array<{ userId: string; role: OrgRole }>> {
    return this.prisma.userOrganization.findMany({
      where: { organizationId, agentStatus: AgentStatus.ONLINE, user: { isActive: true } },
      select: { userId: true, role: true },
    });
  }

  private async agentHours(userId: string, organizationId: string) {
    const membership = await this.prisma.userOrganization.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { workingHours: true },
    });
    return toHoursConfig(membership?.workingHours ?? null);
  }
}
