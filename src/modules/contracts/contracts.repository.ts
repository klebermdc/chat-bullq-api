import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

/**
 * Campos da listagem, escolhidos um a um: sem token de aceite, IP, user agent
 * e termos aceitos. As quatro chaves de arquivo entram só para virar booleanos
 * (`toListItem`) e não saem na resposta.
 */
export const CONTRACT_LIST_SELECT = {
  id: true,
  organizationId: true,
  legacyId: true,
  fullName: true,
  cpf: true,
  address: true,
  cep: true,
  email: true,
  phone: true,
  requestedDates: true,
  guideName: true,
  sellerName: true,
  days: true,
  people: true,
  amount: true,
  pixKey: true,
  disneyGuest: true,
  purchased: true,
  paid: true,
  invoiceIssued: true,
  legacyChatUrl: true,
  acceptedAt: true,
  parkDates: true,
  datesToBeDefined: true,
  notes: true,
  paymentMethod: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  signatureKey: true,
  signedContractKey: true,
  paymentReceiptKey: true,
  acceptancePdfKey: true,
} as const satisfies Prisma.ContractSelect;

/** Todo acesso por id recebe o escopo do ator (`actorScope`): `{}` para staff. */
@Injectable()
export class ContractsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findPage(where: Prisma.ContractWhereInput, skip: number, take: number) {
    return this.prisma.$transaction([
      this.prisma.contract.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take, select: CONTRACT_LIST_SELECT }),
      this.prisma.contract.count({ where }),
    ]);
  }

  count(where: Prisma.ContractWhereInput) {
    return this.prisma.contract.count({ where });
  }

  findAll(where: Prisma.ContractWhereInput, select?: Prisma.ContractSelect) {
    return this.prisma.contract.findMany({ where, orderBy: { createdAt: 'desc' }, ...(select ? { select } : {}) });
  }

  findInOrg(organizationId: string, id: string, scope: Prisma.ContractWhereInput) {
    return this.prisma.contract.findFirst({ where: { AND: [scope], id, organizationId } });
  }

  findByToken(token: string) {
    return this.prisma.contract.findUnique({ where: { acceptanceToken: token } });
  }

  create(data: Prisma.ContractUncheckedCreateInput) {
    return this.prisma.contract.create({ data });
  }

  /**
   * Atualiza só se o contrato for da org e bater `where` (escopo do ator mais
   * condições extras, como `acceptedAt: null`); devolve null se não achou.
   */
  async updateInOrg(
    organizationId: string,
    id: string,
    data: Prisma.ContractUncheckedUpdateInput,
    where: Prisma.ContractWhereInput,
  ) {
    const { count } = await this.prisma.contract.updateMany({ where: { AND: [where], id, organizationId }, data });
    return count ? this.prisma.contract.findFirst({ where: { id, organizationId } }) : null;
  }

  async deleteInOrg(organizationId: string, id: string, scope: Prisma.ContractWhereInput) {
    const { count } = await this.prisma.contract.deleteMany({ where: { AND: [scope], id, organizationId } });
    return count > 0;
  }
}
