import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { OrganizationsRepository } from './organizations.repository';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMemberRoleDto } from './dto/update-member-role.dto';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly repository: OrganizationsRepository) {}

  async getOrganization(orgId: string) {
    const org = await this.repository.findById(orgId);
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async updateOrganization(orgId: string, dto: UpdateOrganizationDto) {
    await this.getOrganization(orgId);
    const {
      aiBusinessHours,
      watchdogBusinessHours,
      watchdogConfig,
      allowedUrlDomains,
      ...rest
    } = dto;
    return this.repository.update(orgId, {
      ...rest,
      ...(aiBusinessHours !== undefined
        ? { aiBusinessHours: aiBusinessHours as object }
        : {}),
      ...(watchdogBusinessHours !== undefined
        ? { watchdogBusinessHours: watchdogBusinessHours as object }
        : {}),
      ...(watchdogConfig !== undefined
        ? { watchdogConfig: watchdogConfig as object }
        : {}),
      ...(allowedUrlDomains !== undefined
        ? {
            allowedUrlDomains:
              allowedUrlDomains === null
                ? Prisma.JsonNull
                : (allowedUrlDomains as Prisma.InputJsonValue),
          }
        : {}),
    });
  }

  async getMembers(orgId: string) {
    return this.repository.findMembers(orgId);
  }

  async inviteMember(orgId: string, dto: InviteMemberDto, inviterId: string, actorRole?: OrgRole) {
    // Só OWNER pode conceder o papel OWNER. Sem esta barreira, um ADMIN podia
    // convidar (auto-aceitando, se o e-mail já existir) alguém como OWNER e
    // escalar privilégio — o mesmo bloqueio já existe em updateMemberRole.
    if (actorRole === 'ADMIN' && dto.role === 'OWNER') {
      throw new ForbiddenException('Only owners can assign the owner role');
    }

    // Check if user already exists and is already a member
    const existingUser = await this.repository.findUserByEmail(dto.email);
    if (existingUser) {
      const existingMembership = await this.repository.findMembership(existingUser.id, orgId);
      if (existingMembership) {
        throw new ConflictException('User is already a member of this organization');
      }
    }

    // Create invitation (works for both existing and non-existing users)
    const invitation = await this.repository.createInvitation(orgId, dto.email, dto.role, inviterId);
    this.logger.log(`Invitation sent to ${dto.email} for org ${orgId} by ${inviterId}`);

    // If user already exists, auto-accept: add them to org immediately
    if (existingUser) {
      await this.repository.addMember(orgId, existingUser.id, dto.role);
      await this.repository.acceptInvitation(invitation.id);
      this.logger.log(`User ${dto.email} auto-added to org ${orgId} (already registered)`);
      return { ...invitation, status: 'ACCEPTED' as const, autoAccepted: true };
    }

    return { ...invitation, autoAccepted: false };
  }

  async validateInvitation(token: string) {
    const invitation = await this.repository.findInvitationByToken(token);
    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }
    if (invitation.status !== 'PENDING') {
      throw new BadRequestException(`Invitation has already been ${invitation.status.toLowerCase()}`);
    }
    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }
    return {
      email: invitation.email,
      role: invitation.role,
      organization: invitation.organization,
    };
  }

  async getInvitations(orgId: string) {
    return this.repository.findInvitationsByOrg(orgId);
  }

  async revokeInvitation(orgId: string, invitationId: string) {
    const invitations = await this.repository.findInvitationsByOrg(orgId);
    const invitation = invitations.find((i) => i.id === invitationId);
    if (!invitation) {
      throw new NotFoundException('Invitation not found in this organization');
    }
    if (invitation.status !== 'PENDING') {
      throw new BadRequestException('Only pending invitations can be revoked');
    }
    return this.repository.revokeInvitation(invitationId);
  }

  async updateMemberRole(orgId: string, memberId: string, dto: UpdateMemberRoleDto, actorRole: OrgRole) {
    const membership = await this.repository.findMembership(memberId, orgId);
    if (!membership) {
      throw new NotFoundException('Member not found in this organization');
    }

    if (membership.role === 'OWNER' && dto.role !== 'OWNER') {
      throw new ForbiddenException('Cannot change the role of the organization owner');
    }

    if (actorRole === 'ADMIN' && dto.role === 'OWNER') {
      throw new ForbiddenException('Only owners can assign the owner role');
    }

    return this.repository.updateMemberRole(membership.id, dto.role);
  }

  async updateMemberRamal(orgId: string, memberId: string, dto: { sonaxRamal?: string }) {
    const membership = await this.repository.findMembership(memberId, orgId);
    if (!membership) throw new NotFoundException('Member not found in organization');
    const ramal = dto.sonaxRamal?.trim() ? dto.sonaxRamal.trim() : null;
    return this.repository.updateMemberRamal(membership.id, ramal);
  }

  async updateMemberWebphone(orgId: string, memberId: string, dto: { webphoneUrl?: string }) {
    const membership = await this.repository.findMembership(memberId, orgId);
    if (!membership) throw new NotFoundException('Member not found in organization');
    const url = this.extractWebphoneUrl(dto.webphoneUrl);
    return this.repository.updateMemberWebphone(membership.id, url);
  }

  /** Webphone (widget Sonax) do atendente LOGADO — pra o chat injetar o script dele. */
  async getMyWebphone(orgId: string, userId: string): Promise<{ webphoneUrl: string | null }> {
    const membership = await this.repository.findMembership(userId, orgId);
    return { webphoneUrl: membership?.sonaxWebphoneUrl ?? null };
  }

  /**
   * Aceita a URL do widget OU o `<script ... src="URL">` inteiro colado — extrai o
   * src. Só aceita o host oficial do webphone Sonax (evita injetar script arbitrário).
   * Vazio => null (limpa).
   */
  private extractWebphoneUrl(input?: string): string | null {
    const raw = (input ?? '').trim();
    if (!raw) return null;
    const fromTag = raw.match(/src\s*=\s*["']([^"']+)["']/i)?.[1];
    const url = (fromTag ?? raw).trim();
    if (!/^https:\/\/([a-z0-9-]+\.)*sonax\.(cloud|net\.br)\//i.test(url)) {
      throw new BadRequestException(
        'URL de webphone inválida (esperado o widget da Sonax: https://webphone2.sonax.cloud/...)',
      );
    }
    return url;
  }

  async removeMember(orgId: string, memberId: string, actorId: string) {
    const membership = await this.repository.findMembership(memberId, orgId);
    if (!membership) {
      throw new NotFoundException('Member not found in this organization');
    }

    if (membership.role === 'OWNER') {
      throw new ForbiddenException('Cannot remove the organization owner');
    }

    // Compara pelo userId REAL do membership, não pelo memberId da URL: como
    // findMembership resolve por id de membership primeiro, `memberId` costuma
    // ser o id da userOrganization (≠ actorId, que é o id do user), então a
    // comparação antiga nunca batia e a trava de auto-remoção não funcionava.
    if (membership.userId === actorId) {
      throw new BadRequestException('Cannot remove yourself. Transfer ownership first.');
    }

    await this.repository.removeMember(membership.id);
    this.logger.log(`Member ${memberId} removed from org ${orgId} by ${actorId}`);
  }

  // Admin-driven password reset (set a member's password without knowing the
  // old one). Redefinir senha = tomar a conta, então o RBAC é mais estrito que
  // o de role/remoção: NINGUÉM redefine um OWNER por aqui (owners trocam a
  // própria senha via self-service em /users/me/change-password), e um ADMIN só
  // pode redefinir AGENTE — não outro ADMIN — pra evitar tomada lateral.
  async resetMemberPassword(
    orgId: string,
    memberId: string,
    dto: { newPassword: string },
    actorRole: OrgRole,
  ) {
    const membership = await this.repository.findMembership(memberId, orgId);
    if (!membership) {
      throw new NotFoundException('Member not found in this organization');
    }

    if (membership.role === 'OWNER') {
      throw new ForbiddenException(
        'Cannot reset the password of an organization owner',
      );
    }

    if (actorRole === 'ADMIN' && membership.role === 'ADMIN') {
      throw new ForbiddenException(
        'Admins can only reset the password of operators',
      );
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, BCRYPT_ROUNDS);
    await this.repository.updateUserPassword(membership.userId, hashedPassword);
    this.logger.log(
      `Password reset for member ${memberId} in org ${orgId} by a ${actorRole}`,
    );
  }
}
