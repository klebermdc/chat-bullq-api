import { Injectable } from '@nestjs/common';
import { Prisma, CadenceEnrollment } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class EnrollmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    data: Prisma.CadenceEnrollmentUncheckedCreateInput,
  ): Promise<CadenceEnrollment> {
    try {
      return await this.prisma.cadenceEnrollment.create({ data });
    } catch (err) {
      // FIX 3: corrida vencida por outro request → o índice único parcial
      // `uq_active_enrollment_per_conversation` dispara P2002. Resolve
      // limpo devolvendo o enrollment ACTIVE que já existe.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const existing = await this.findActiveByConversation(
          data.conversationId,
        );
        if (existing) return existing;
      }
      throw err;
    }
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

  /**
   * FIX 4: compare-and-set do encerramento. Só grava se ainda estiver ACTIVE;
   * devolve `true` quando ESTE caminho fez a transição (count === 1), `false`
   * quando outro caminho já finalizou. É a porta autoritativa contra corrida.
   */
  async finishIfActive(
    id: string,
    data: Prisma.CadenceEnrollmentUpdateManyMutationInput,
  ): Promise<boolean> {
    const res = await this.prisma.cadenceEnrollment.updateMany({
      where: { id, status: 'ACTIVE' },
      data,
    });
    return res.count === 1;
  }
}
