import { Injectable } from '@nestjs/common';
import { Prisma, type MysteryShopperBotStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

export const BOT_LIVE_STATUSES: MysteryShopperBotStatus[] = ['ACTIVE', 'CLOSING'];

const RUN_SELECT = {
  id: true,
  organizationId: true,
  numberId: true,
  persona: true,
  status: true,
  clientMessages: true,
  followUpAnswered: true,
  lastError: true,
  createdAt: true,
} as const;

export interface BotRunRow {
  id: string;
  organizationId: string;
  numberId: string;
  persona: string;
  status: MysteryShopperBotStatus;
  clientMessages: number;
  followUpAnswered: boolean;
  lastError: string | null;
  createdAt: Date;
}

@Injectable()
export class BotRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveRun(organizationId: string, numberId: string): Promise<BotRunRow | null> {
    return this.prisma.mysteryShopperBotRun.findFirst({
      where: { organizationId, numberId, status: { in: BOT_LIVE_STATUSES } },
      orderBy: { createdAt: 'desc' },
      select: RUN_SELECT,
    });
  }

  findLatestRun(organizationId: string, numberId: string): Promise<BotRunRow | null> {
    return this.prisma.mysteryShopperBotRun.findFirst({
      where: { organizationId, numberId },
      orderBy: { createdAt: 'desc' },
      select: RUN_SELECT,
    });
  }

  /**
   * Checa e cria na mesma transação Serializable: duas partidas simultâneas não passam as duas.
   * null = já existe execução viva (ou conflito de serialização).
   */
  async createRunExclusive(organizationId: string, numberId: string, persona: string): Promise<BotRunRow | null> {
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const live = await tx.mysteryShopperBotRun.findFirst({
            where: { organizationId, numberId, status: { in: BOT_LIVE_STATUSES } },
            select: { id: true },
          });
          if (live) return null;
          return tx.mysteryShopperBotRun.create({
            data: { organizationId, numberId, persona, clientMessages: 1 },
            select: RUN_SELECT,
          });
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') return null;
      throw err;
    }
  }

  /** Só sai de ACTIVE/CLOSING: nunca reescreve um fim já registrado. */
  async stopRun(runId: string): Promise<BotRunRow | null> {
    await this.prisma.mysteryShopperBotRun.updateMany({
      where: { id: runId, status: { in: BOT_LIVE_STATUSES } },
      data: { status: 'STOPPED', endedAt: new Date() },
    });
    return this.prisma.mysteryShopperBotRun.findUnique({ where: { id: runId }, select: RUN_SELECT });
  }

  async failRun(runId: string, error: string, costUsd = 0): Promise<void> {
    await this.prisma.mysteryShopperBotRun.updateMany({
      where: { id: runId, status: { in: BOT_LIVE_STATUSES } },
      data: { status: 'FAILED', lastError: error.slice(0, 500), endedAt: new Date(), costUsd: { increment: costUsd } },
    });
  }

  /** Só soma custo (sem filtro de status): a IA foi paga mesmo que a execução tenha sido parada. */
  async addCost(runId: string, costUsd: number): Promise<void> {
    await this.prisma.mysteryShopperBotRun.update({ where: { id: runId }, data: { costUsd: { increment: costUsd } } });
  }

  findRun(runId: string): Promise<BotRunRow | null> {
    return this.prisma.mysteryShopperBotRun.findUnique({ where: { id: runId }, select: RUN_SELECT });
  }

  async findTimezone(organizationId: string): Promise<string | null> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId }, select: { aiTimezone: true } });
    return org?.aiTimezone ?? null;
  }

  /** Registra o resultado de um turno; só mexe em execução ainda viva (parar durante o turno vence). */
  async recordTurn(
    runId: string,
    turn: { status: MysteryShopperBotStatus; sent: boolean; followUpAnswered: boolean; costUsd: number },
  ): Promise<void> {
    const ended = turn.status === 'ENDED';
    await this.prisma.mysteryShopperBotRun.updateMany({
      where: { id: runId, status: { in: BOT_LIVE_STATUSES } },
      data: {
        status: turn.status,
        followUpAnswered: turn.followUpAnswered,
        clientMessages: turn.sent ? { increment: 1 } : undefined,
        costUsd: { increment: turn.costUsd },
        endedAt: ended ? new Date() : undefined,
      },
    });
  }
}
