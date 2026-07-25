import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class PlatformRepository {
  constructor(private readonly prisma: PrismaService) {}

  findOrgBySlug(slug: string) {
    return this.prisma.organization.findUnique({ where: { slug } });
  }

  findUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  /** Cria org + usuário dono + membership OWNER + departamento padrão, atômico. */
  createOrgWithOwner(input: {
    companyName: string;
    slug: string;
    plan: string;
    ownerName: string;
    ownerEmail: string;
    ownerPasswordHash: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: input.ownerName,
          email: input.ownerEmail,
          password: input.ownerPasswordHash,
        },
      });
      const organization = await tx.organization.create({
        data: { name: input.companyName, slug: input.slug, plan: input.plan },
      });
      const membership = await tx.userOrganization.create({
        data: { userId: user.id, organizationId: organization.id, role: 'OWNER' },
      });
      const defaultDepartment = await tx.department.create({
        data: {
          organizationId: organization.id,
          name: 'Geral',
          description: 'Departamento padrão',
          isDefault: true,
        },
      });
      await tx.departmentAgent.create({
        data: { departmentId: defaultDepartment.id, userOrganizationId: membership.id },
      });
      return { organization, user };
    });
  }

  listOrganizations() {
    return this.prisma.organization.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        plan: true,
        suspendedAt: true,
        createdAt: true,
        _count: { select: { members: true, conversations: true } },
      },
    });
  }

  findOrgById(id: string) {
    return this.prisma.organization.findFirst({ where: { id, deletedAt: null } });
  }

  setSuspended(id: string, suspendedAt: Date | null) {
    return this.prisma.organization.update({ where: { id }, data: { suspendedAt } });
  }
}
