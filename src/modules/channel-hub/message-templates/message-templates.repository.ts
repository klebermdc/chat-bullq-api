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
    return this.setChannelMarker('isReengagement', channelId, id);
  }

  /** Troca o template de distribuição do canal: desmarca o anterior e marca este. */
  setDistribution(channelId: string, id: string) {
    return this.setChannelMarker('isDistribution', channelId, id);
  }

  private setChannelMarker(
    field: 'isReengagement' | 'isDistribution',
    channelId: string,
    id: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.messageTemplate.updateMany({
        where: { channelId, [field]: true, NOT: { id } },
        data: { [field]: false },
      });
      return tx.messageTemplate.update({
        where: { id },
        data: { [field]: true },
      });
    });
  }

  delete(id: string) {
    return this.prisma.messageTemplate.delete({ where: { id } });
  }
}
