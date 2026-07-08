import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class InactivityRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Conversas abertas (não fechadas/arquivadas) de uma org com outbound já
   * enviada. Traz só o necessário pro cálculo de faixa + o que o auto-reengage
   * precisa (contactId/channelId/assignedToId). O filtro "bola com o cliente"
   * é aplicado em memória via `computeBand` (que usa `ballIsWithClient`).
   */
  scanCandidates(organizationId: string) {
    return this.prisma.conversation.findMany({
      where: {
        organizationId,
        status: { not: 'CLOSED' },
        isArchived: false,
        lastOutboundAt: { not: null },
      },
      select: {
        id: true,
        contactId: true,
        channelId: true,
        lastInboundAt: true,
        lastOutboundAt: true,
        inactivityBand: true,
        assignedToId: true,
        reengageDismissedAt: true,
        reengagedAt: true,
      },
    });
  }

  setBand(conversationId: string, band: number | null): Promise<unknown> {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { inactivityBand: band },
    });
  }

  /** UPDATE em lote da faixa para várias conversas (watchdog). */
  setBandBulk(ids: string[], band: number | null): Promise<unknown> {
    if (ids.length === 0) return Promise.resolve(null);
    return this.prisma.conversation.updateMany({
      where: { id: { in: ids } },
      data: { inactivityBand: band },
    });
  }

  /** Marca que a conversa já recebeu um burst de reengajamento nesta streak. */
  markReengaged(conversationId: string): Promise<unknown> {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: { reengagedAt: new Date() },
    });
  }

  /** Fuso da org (para resolver quiet hours). Fallback America/Sao_Paulo. */
  async orgTimezone(organizationId: string): Promise<string> {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { aiTimezone: true },
    });
    return org?.aiTimezone ?? 'America/Sao_Paulo';
  }

  /** Contagem por faixa. assignedToId opcional (RN-05 AGENT scope). */
  async countByBand(organizationId: string, assignedToId?: string) {
    const rows = await this.prisma.conversation.groupBy({
      by: ['inactivityBand'],
      where: {
        organizationId,
        isArchived: false,
        status: { not: 'CLOSED' },
        inactivityBand: { not: null },
        ...(assignedToId ? { assignedToId } : {}),
      },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      band: r.inactivityBand as number,
      count: r._count._all,
    }));
  }

  /** Lista paginada de inativos com dados do contato/canal. */
  listInactive(params: {
    organizationId: string;
    assignedToId?: string;
    band?: number;
    skip: number;
    take: number;
  }) {
    const { organizationId, assignedToId, band, skip, take } = params;
    return this.prisma.conversation.findMany({
      where: {
        organizationId,
        isArchived: false,
        status: { not: 'CLOSED' },
        inactivityBand: band !== undefined ? band : { not: null },
        ...(assignedToId ? { assignedToId } : {}),
      },
      select: {
        id: true,
        inactivityBand: true,
        lastOutboundAt: true,
        lastInboundAt: true,
        contact: { select: { id: true, name: true } },
        channel: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, name: true } },
        scheduledMessages: {
          where: { status: 'PENDING' },
          select: { id: true, scheduledAt: true },
          take: 1,
        },
      },
      orderBy: { lastOutboundAt: 'asc' },
      skip,
      take,
    });
  }

  /**
   * Resolve o "usuário de sistema" responsável por um disparo AUTO_REENGAGE:
   * `assignedToId` da conversa se houver, senão o userId de um membro OWNER da
   * org. Retorna null se não houver ninguém resolvível (aí o auto-reengage
   * pula sem agendar).
   */
  async resolveSystemSender(
    organizationId: string,
    assignedToId: string | null,
  ): Promise<string | null> {
    if (assignedToId) return assignedToId;
    const owner = await this.prisma.userOrganization.findFirst({
      where: { organizationId, role: 'OWNER' },
      select: { userId: true },
    });
    return owner?.userId ?? null;
  }
}
