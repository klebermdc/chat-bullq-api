import { Injectable } from '@nestjs/common';
import { Prisma, CadenceEnrollment } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class EnrollmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: Prisma.CadenceEnrollmentUncheckedCreateInput,
  ): Promise<CadenceEnrollment> {
    return this.prisma.cadenceEnrollment.create({ data });
  }

  findById(id: string): Promise<CadenceEnrollment | null> {
    return this.prisma.cadenceEnrollment.findUnique({ where: { id } });
  }

  findActiveByConversation(
    conversationId: string,
  ): Promise<CadenceEnrollment | null> {
    return this.prisma.cadenceEnrollment.findFirst({
      where: { conversationId, status: 'ACTIVE' },
    });
  }

  update(
    id: string,
    data: Prisma.CadenceEnrollmentUncheckedUpdateInput,
  ): Promise<CadenceEnrollment> {
    return this.prisma.cadenceEnrollment.update({ where: { id }, data });
  }
}
