import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { OrgRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    if (dto.name !== undefined) await this.assertCanRename(userId, dto.name);
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: dto,
    });

    const { password: _, ...sanitized } = user;
    return sanitized;
  }

  /**
   * O nome do atendente vincula o relatório de vendas ao vendedor do OFP Hub
   * (sales-reports/vendedor-match). Se o atendente pudesse trocá-lo, veria as
   * vendas de outra pessoa — por isso só Admin/Owner (ou super admin) renomeia.
   */
  private async assertCanRename(userId: string, newName: string): Promise<void> {
    const current = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!current) throw new BadRequestException('User not found');
    if (current.name === newName || current.isSuperAdmin) return;
    const managerships = await this.prisma.userOrganization.count({
      where: { userId, role: { in: [OrgRole.OWNER, OrgRole.ADMIN] } },
    });
    if (managerships === 0) {
      throw new ForbiddenException('Só um administrador pode alterar o nome do atendente.');
    }
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const isValid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!isValid) {
      throw new BadRequestException('Current password is incorrect');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });

    this.logger.log(`Password changed for user ${userId}`);
  }

  async getPreferences(userId: string, organizationId: string) {
    const membership = await this.prisma.userOrganization.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { preferences: true },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    return (membership.preferences ?? {}) as Record<string, unknown>;
  }

  async updatePreferences(
    userId: string,
    organizationId: string,
    patch: Record<string, unknown>,
  ) {
    const current = await this.getPreferences(userId, organizationId);
    const merged = { ...current, ...patch };

    await this.prisma.userOrganization.update({
      where: { userId_organizationId: { userId, organizationId } },
      data: { preferences: merged as Prisma.InputJsonValue },
    });

    return merged;
  }
}
