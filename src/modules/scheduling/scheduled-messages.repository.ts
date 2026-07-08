import { Injectable } from '@nestjs/common';
import { Prisma, ScheduledMessage } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ScheduledMessagesRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ScheduledMessageUncheckedCreateInput): Promise<ScheduledMessage> {
    return this.prisma.scheduledMessage.create({ data });
  }

  findById(id: string): Promise<ScheduledMessage | null> {
    return this.prisma.scheduledMessage.findUnique({ where: { id } });
  }

  listByConversation(conversationId: string, status?: string): Promise<ScheduledMessage[]> {
    return this.prisma.scheduledMessage.findMany({
      where: { conversationId, ...(status ? { status: status as any } : {}) },
      orderBy: { scheduledAt: 'asc' },
    });
  }

  update(
    id: string,
    data: Prisma.ScheduledMessageUncheckedUpdateInput,
  ): Promise<ScheduledMessage> {
    return this.prisma.scheduledMessage.update({ where: { id }, data });
  }

  /** Atomic claim: only succeeds if still PENDING. Returns true if claimed. */
  async claimForDispatch(id: string): Promise<boolean> {
    const res = await this.prisma.scheduledMessage.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'SENDING' },
    });
    return res.count === 1;
  }

  /** Pendentes de uma conversa, opcionalmente filtrando por origin. */
  findPending(conversationId: string, origin?: string): Promise<ScheduledMessage[]> {
    return this.prisma.scheduledMessage.findMany({
      where: {
        conversationId,
        status: 'PENDING',
        ...(origin ? { origin: origin as any } : {}),
      },
    });
  }
}
