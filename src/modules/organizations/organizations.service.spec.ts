import { Test } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { OrganizationsService } from './organizations.service';
import { OrganizationsRepository } from './organizations.repository';

describe('OrganizationsService.resetMemberPassword', () => {
  let service: OrganizationsService;
  let repo: jest.Mocked<
    Pick<OrganizationsRepository, 'findMembership' | 'updateUserPassword'>
  >;

  const membership = (role: OrgRole) => ({
    id: 'membership-1',
    userId: 'user-1',
    organizationId: 'org-1',
    role,
  });

  beforeEach(async () => {
    repo = {
      findMembership: jest.fn(),
      updateUserPassword: jest.fn().mockResolvedValue(undefined),
    } as any;

    const mod = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: OrganizationsRepository, useValue: repo },
      ],
    }).compile();
    service = mod.get(OrganizationsService);
  });

  it('hashes the new password and persists it for the target user', async () => {
    repo.findMembership.mockResolvedValue(membership(OrgRole.AGENT) as any);

    await service.resetMemberPassword(
      'org-1',
      'membership-1',
      { newPassword: 'novaSenha123' },
      OrgRole.OWNER,
    );

    expect(repo.updateUserPassword).toHaveBeenCalledTimes(1);
    const [userId, hash] = repo.updateUserPassword.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(hash).not.toBe('novaSenha123');
    expect(await bcrypt.compare('novaSenha123', hash)).toBe(true);
  });

  it('throws NotFound when the member is not in the organization', async () => {
    repo.findMembership.mockResolvedValue(null);

    await expect(
      service.resetMemberPassword(
        'org-1',
        'ghost',
        { newPassword: 'novaSenha123' },
        OrgRole.OWNER,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.updateUserPassword).not.toHaveBeenCalled();
  });

  it('never lets anyone reset an OWNER password (owners use self-service)', async () => {
    repo.findMembership.mockResolvedValue(membership(OrgRole.OWNER) as any);

    await expect(
      service.resetMemberPassword(
        'org-1',
        'membership-1',
        { newPassword: 'novaSenha123' },
        OrgRole.OWNER,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.updateUserPassword).not.toHaveBeenCalled();
  });

  it('blocks an ADMIN from resetting another ADMIN (lateral takeover)', async () => {
    repo.findMembership.mockResolvedValue(membership(OrgRole.ADMIN) as any);

    await expect(
      service.resetMemberPassword(
        'org-1',
        'membership-1',
        { newPassword: 'novaSenha123' },
        OrgRole.ADMIN,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.updateUserPassword).not.toHaveBeenCalled();
  });

  it('lets an OWNER reset an ADMIN password', async () => {
    repo.findMembership.mockResolvedValue(membership(OrgRole.ADMIN) as any);

    await service.resetMemberPassword(
      'org-1',
      'membership-1',
      { newPassword: 'novaSenha123' },
      OrgRole.OWNER,
    );

    expect(repo.updateUserPassword).toHaveBeenCalledTimes(1);
  });

  it('lets an ADMIN reset an AGENT password', async () => {
    repo.findMembership.mockResolvedValue(membership(OrgRole.AGENT) as any);

    await service.resetMemberPassword(
      'org-1',
      'membership-1',
      { newPassword: 'novaSenha123' },
      OrgRole.ADMIN,
    );

    expect(repo.updateUserPassword).toHaveBeenCalledTimes(1);
  });
});
