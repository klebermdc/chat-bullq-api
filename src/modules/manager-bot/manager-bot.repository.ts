import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { LOST_REASONS } from '../pipelines/lost-sale.constants';
import type { ManagerChat } from './manager-bot.config';
import type { Range } from './manager-bot.rules';
import type { LostCount } from './reports/closing.report';

type Raw = Record<string, unknown>;

const isObject = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

/** Banco do gerente no Telegram. Só leitura, exceto o cadastro de chat. */
@Injectable()
export class ManagerBotRepository {
  constructor(private readonly prisma: PrismaService) {}

  countEntered(organizationId: string, range: Range): Promise<number> {
    return this.prisma.conversation.count({
      where: { organizationId, deletedAt: null, createdAt: { gte: range.from, lt: range.to } },
    });
  }

  countClosed(organizationId: string, range: Range): Promise<number> {
    return this.prisma.conversation.count({
      where: { organizationId, deletedAt: null, closedAt: { gte: range.from, lt: range.to } },
    });
  }

  async lostByReason(organizationId: string, range: Range): Promise<LostCount[]> {
    const groups = await this.prisma.conversation.groupBy({
      by: ['lostReason'],
      where: { organizationId, deletedAt: null, lostAt: { gte: range.from, lt: range.to } },
      _count: { _all: true },
    });
    return groups.map((g) => ({
      reason: LOST_REASONS[g.lostReason as keyof typeof LOST_REASONS] ?? g.lostReason ?? 'Sem motivo',
      count: g._count._all,
    }));
  }

  async lostByAgent(organizationId: string, range: Range): Promise<Array<{ vendedor: string; count: number }>> {
    const groups = await this.prisma.conversation.groupBy({
      by: ['lostById'],
      where: { organizationId, deletedAt: null, lostAt: { gte: range.from, lt: range.to } },
      _count: { _all: true },
    });
    const ids = groups.flatMap((g) => (g.lostById ? [g.lostById] : []));
    const users = ids.length
      ? await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [];
    const names = new Map(users.map((u) => [u.id, u.name]));
    return groups
      .map((g) => ({ vendedor: (g.lostById && names.get(g.lostById)) || 'Sem autor', count: g._count._all }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Cadastra o chat e troca o código de uso único, numa transação que relê
   * as settings (não perde alteração feita entre a leitura e a escrita).
   */
  async addChat(organizationId: string, chat: ManagerChat, nextLinkCode: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { settings: true },
      });
      const settings = isObject(org.settings) ? org.settings : {};
      const bot = isObject(settings.managerBot) ? settings.managerBot : {};
      const chats = Array.isArray(bot.chats) ? bot.chats : [];
      const nextSettings = {
        ...settings,
        managerBot: { ...bot, chats: [...chats, chat], linkCode: nextLinkCode },
      };
      await tx.organization.update({
        where: { id: organizationId },
        data: { settings: nextSettings as Prisma.InputJsonValue },
      });
    });
  }
}
