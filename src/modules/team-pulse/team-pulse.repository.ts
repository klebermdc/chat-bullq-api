import { Injectable } from '@nestjs/common';
import { ConversationStatus, type Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { REAL_CONVERSATION } from '../../common/mystery-shopper.filters';
import { PENDING_HANDOFF, WITH_AI } from '../messaging/conversations/inbox-advanced-where';
import type { LeadCounts } from './team-pulse.format';

export interface Range {
  from: Date;
  to: Date;
}

/** Aberta e sem atendente: base das fases "Com a IA" e "Na fila" da inbox. */
const OPEN_UNASSIGNED = {
  status: { not: ConversationStatus.CLOSED },
  assignedToId: null,
} as const satisfies Prisma.ConversationWhereInput;

/** Consultas do pulso que ainda não existiam em outro módulo. Só leitura. */
@Injectable()
export class TeamPulseRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Esperas que estouraram o SLA no período, com o dono. */
  async listBreaches(organizationId: string, range: Range): Promise<Array<{ agentName: string | null }>> {
    const rows = await this.prisma.responseSlaRecord.findMany({
      where: { organizationId, breachedAt: { gte: range.from, lt: range.to } },
      select: { agent: { select: { name: true } } },
    });
    return rows.map((r) => ({ agentName: r.agent?.name ?? null }));
  }

  /**
   * Conversas novas no período (mesma contagem do "Entraram" do gerente no
   * Telegram) e, delas, quantas estão agora com a Aline ou na fila.
   */
  async countLeads(organizationId: string, range: Range): Promise<LeadCounts> {
    const base: Prisma.ConversationWhereInput = {
      organizationId,
      deletedAt: null,
      ...REAL_CONVERSATION,
      createdAt: { gte: range.from, lt: range.to },
    };
    const [total, withAi, inQueue] = await Promise.all([
      this.prisma.conversation.count({ where: base }),
      this.prisma.conversation.count({ where: { AND: [base, OPEN_UNASSIGNED, WITH_AI] } }),
      this.prisma.conversation.count({ where: { AND: [base, OPEN_UNASSIGNED, PENDING_HANDOFF] } }),
    ]);
    return { total, withAi, inQueue };
  }
}
