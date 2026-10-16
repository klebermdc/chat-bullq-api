import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ContractsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findPage(where: Prisma.ContractWhereInput, skip: number, take: number) {
    return this.prisma.$transaction([
      this.prisma.contract.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.contract.count({ where }),
    ]);
  }

  findAll(where: Prisma.ContractWhereInput, select?: Prisma.ContractSelect) {
    return this.prisma.contract.findMany({ where, orderBy: { createdAt: 'desc' }, ...(select ? { select } : {}) });
  }

  findInOrg(organizationId: string, id: string) {
    return this.prisma.contract.findFirst({ where: { id, organizationId } });
  }

  findByToken(token: string) {
    return this.prisma.contract.findUnique({ where: { acceptanceToken: token } });
  }

  create(data: Prisma.ContractUncheckedCreateInput) {
    return this.prisma.contract.create({ data });
  }

  /** Atualiza só se o contrato for da org; devolve null se não achou. */
  async updateInOrg(organizationId: string, id: string, data: Prisma.ContractUncheckedUpdateInput) {
    const { count } = await this.prisma.contract.updateMany({ where: { id, organizationId }, data });
    return count ? this.findInOrg(organizationId, id) : null;
  }

  async deleteInOrg(organizationId: string, id: string) {
    const { count } = await this.prisma.contract.deleteMany({ where: { id, organizationId } });
    return count > 0;
  }
}
