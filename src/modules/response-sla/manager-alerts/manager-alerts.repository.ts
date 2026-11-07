import { Injectable } from '@nestjs/common';
import { ChannelType, ConversationStatus, type Channel } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { COUNTED_WAIT_WHERE } from '../../dashboard/response-sla-metrics';
import { DEFAULT_TIMEZONE, resolveHours, toHoursConfig } from '../response-sla.rules';
import type { OpenWait, ScoreRow } from './manager-alerts.selection';

export interface AlertOrg {
  id: string;
  settings: unknown;
  tz: string;
  orgHours: ReturnType<typeof toHoursConfig>;
}

const ORG_SELECT = {
  id: true,
  settings: true,
  aiTimezone: true,
  aiBusinessHours: true,
} as const;

/** Mesma regra da aba "Esperando" (isWaitingForHuman), em filtro do Prisma. */
const CONVERSATION_WAITING = {
  awaitingHumanReply: true,
  status: { not: ConversationStatus.CLOSED },
  deletedAt: null,
  isArchived: false,
} as const;

/** Acesso a banco dos avisos à gestão. Só leitura. */
@Injectable()
export class ManagerAlertsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Orgs ativas; o filtro da config é feito no código (são poucas orgs). */
  async listActiveOrgs(): Promise<AlertOrg[]> {
    const orgs = await this.prisma.organization.findMany({
      where: { deletedAt: null, suspendedAt: null },
      select: ORG_SELECT,
    });
    return orgs.map(toAlertOrg);
  }

  async findOrg(id: string): Promise<AlertOrg | null> {
    const org = await this.prisma.organization.findUnique({ where: { id }, select: ORG_SELECT });
    return org ? toAlertOrg(org) : null;
  }

  findChannel(organizationId: string, channelId: string): Promise<Channel | null> {
    return this.prisma.channel.findFirst({
      where: {
        id: channelId,
        organizationId,
        type: ChannelType.WHATSAPP_OFFICIAL,
        isActive: true,
        deletedAt: null,
      },
    });
  }

  /** Esperas abertas com a agenda que vale para cada uma (mesma regra do SLA). */
  async listOpenWaits(org: AlertOrg): Promise<OpenWait[]> {
    const records = await this.prisma.responseSlaRecord.findMany({
      where: {
        organizationId: org.id,
        respondedAt: null,
        endedAt: null,
        conversation: CONVERSATION_WAITING,
      },
      select: {
        waitingSince: true,
        conversation: {
          select: {
            assignedToId: true,
            assignedTo: { select: { name: true } },
            contact: { select: { name: true, phone: true } },
          },
        },
      },
    });
    const agentHours = await this.agentHours(
      org.id,
      records.flatMap((r) => (r.conversation.assignedToId ? [r.conversation.assignedToId] : [])),
    );
    return records.map((r) => {
      const ownerId = r.conversation.assignedToId;
      return {
        contactName: r.conversation.contact?.name || r.conversation.contact?.phone || 'Cliente',
        agentName: ownerId ? (r.conversation.assignedTo?.name ?? null) : null,
        waitingSince: r.waitingSince,
        hours: resolveHours(ownerId ? (agentHours.get(ownerId) ?? null) : null, org.orgHours),
      };
    });
  }

  /** Esperas do período que contam no % (mesmo filtro do dashboard). */
  async listCountedWaits(organizationId: string, from: Date, to: Date): Promise<ScoreRow[]> {
    const rows = await this.prisma.responseSlaRecord.findMany({
      where: { organizationId, waitingSince: { gte: from, lte: to }, ...COUNTED_WAIT_WHERE },
      select: { agentId: true, respondedAt: true, breached: true, agent: { select: { name: true } } },
    });
    return rows.map((r) => ({
      agentId: r.agentId,
      agentName: r.agent?.name ?? null,
      respondedAt: r.respondedAt,
      breached: r.breached,
    }));
  }

  private async agentHours(organizationId: string, userIds: string[]) {
    if (userIds.length === 0) return new Map<string, ReturnType<typeof toHoursConfig>>();
    const memberships = await this.prisma.userOrganization.findMany({
      where: { organizationId, userId: { in: [...new Set(userIds)] } },
      select: { userId: true, workingHours: true },
    });
    return new Map(memberships.map((m) => [m.userId, toHoursConfig(m.workingHours)]));
  }
}

function toAlertOrg(org: {
  id: string;
  settings: unknown;
  aiTimezone: string | null;
  aiBusinessHours: unknown;
}): AlertOrg {
  return {
    id: org.id,
    settings: org.settings,
    tz: org.aiTimezone || DEFAULT_TIMEZONE,
    orgHours: toHoursConfig(org.aiBusinessHours),
  };
}
