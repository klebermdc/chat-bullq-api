import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class MessageTemplatesRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.MessageTemplateUncheckedCreateInput) {
    return this.prisma.messageTemplate.create({ data });
  }

  findManyByChannel(organizationId: string, channelId: string) {
    return this.prisma.messageTemplate.findMany({
      where: { organizationId, channelId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  findById(organizationId: string, id: string) {
    return this.prisma.messageTemplate.findFirst({
      where: { id, organizationId },
    });
  }

  update(id: string, data: Prisma.MessageTemplateUncheckedUpdateInput) {
    return this.prisma.messageTemplate.update({ where: { id }, data });
  }

  updateByMetaId(
    metaTemplateId: string,
    data: Prisma.MessageTemplateUncheckedUpdateInput,
  ) {
    return this.prisma.messageTemplate.updateMany({
      where: { metaTemplateId },
      data,
    });
  }

  /** Troca o template de retomada do canal: desmarca o anterior e marca este. */
  setReengagement(channelId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.messageTemplate.updateMany({
        where: { channelId, isReengagement: true, NOT: { id } },
        data: { isReengagement: false },
      });
      return tx.messageTemplate.update({
        where: { id },
        data: { isReengagement: true },
      });
    });
  }

  delete(id: string) {
    return this.prisma.messageTemplate.delete({ where: { id } });
  }
}
