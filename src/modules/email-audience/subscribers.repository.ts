import { Injectable } from '@nestjs/common';
import { EmailSubscriberStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class SubscribersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.emailSubscriber.findUnique({ where: { id } });
  }

  findByEmail(organizationId: string, email: string) {
    return this.prisma.emailSubscriber.findUnique({
      where: { uq_email_subscriber_org_email: { organizationId, email } },
    });
  }

  create(data: Prisma.EmailSubscriberUncheckedCreateInput) {
    return this.prisma.emailSubscriber.create({ data });
  }

  update(id: string, data: Prisma.EmailSubscriberUncheckedUpdateInput) {
    return this.prisma.emailSubscriber.update({ where: { id }, data });
  }

  /** Base inscrita inteira, sem filtro de público — usado quando a campanha não segmenta. */
  findSendable(organizationId: string) {
    return this.prisma.emailSubscriber.findMany({
      where: { organizationId, status: EmailSubscriberStatus.SUBSCRIBED },
      select: { id: true, email: true, name: true },
    });
  }

  /**
   * Expansão do público filtrado. `where` vem SEMPRE de `buildAudienceWhere`
   * — nunca montado à mão aqui, para não divergir de `countByWhere`.
   */
  findByWhere(where: Prisma.EmailSubscriberWhereInput) {
    return this.prisma.emailSubscriber.findMany({
      where,
      select: { id: true, email: true, name: true },
    });
  }

  /** Contagem do público filtrado. Mesma `where` do disparo — ver `findByWhere`. */
  countByWhere(where: Prisma.EmailSubscriberWhereInput) {
    return this.prisma.emailSubscriber.count({ where });
  }

  list(organizationId: string, status?: EmailSubscriberStatus, skip = 0, take = 50) {
    const where = { organizationId, ...(status ? { status } : {}) };
    return this.prisma.$transaction([
      this.prisma.emailSubscriber.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.emailSubscriber.count({ where }),
    ]);
  }
}
