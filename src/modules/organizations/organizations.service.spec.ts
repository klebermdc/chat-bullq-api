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
    Pick<
      OrganizationsRepository,
      | 'findMembership'
      | 'updateUserPassword'
      | 'updateMemberRamal'
      | 'updateMemberWebphone'
      | 'updateMemberWorkingHours'
    >
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
      updateMemberRamal: jest.fn(),
      updateMemberWebphone: jest.fn(),
      updateMemberWorkingHours: jest.fn(),
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

  it('lets an OWNER reset another OWNER password', async () => {
    repo.findMembership.mockResolvedValue(membership(OrgRole.OWNER) as any);

    await service.resetMemberPassword(
      'org-1',
      'membership-1',
      { newPassword: 'novaSenha123' },
      OrgRole.OWNER,
    );

    expect(repo.updateUserPassword).toHaveBeenCalledTimes(1);
  });

  it('blocks an ADMIN from resetting an OWNER (lateral takeover)', async () => {
    repo.findMembership.mockResolvedValue(membership(OrgRole.OWNER) as any);

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

  describe('updateMemberWebphone', () => {
    it('extrai o src de um <script> colado (host Sonax)', async () => {
      repo.findMembership.mockResolvedValue(membership(OrgRole.AGENT) as any);
      repo.updateMemberWebphone.mockResolvedValue({} as any);
      await service.updateMemberWebphone('org-1', 'membership-1', {
        webphoneUrl: '<script id="widget-script" src="https://webphone2.sonax.cloud/widget?data=abc&dataClient=103121"></script>',
      });
      expect(repo.updateMemberWebphone).toHaveBeenCalledWith(
        'membership-1',
        'https://webphone2.sonax.cloud/widget?data=abc&dataClient=103121',
      );
    });

    it('aceita a URL crua do webphone Sonax', async () => {
      repo.findMembership.mockResolvedValue(membership(OrgRole.AGENT) as any);
      repo.updateMemberWebphone.mockResolvedValue({} as any);
      await service.updateMemberWebphone('org-1', 'membership-1', {
        webphoneUrl: 'https://webphone2.sonax.cloud/widget?data=xyz&dataClient=103121',
      });
      expect(repo.updateMemberWebphone).toHaveBeenCalledWith('membership-1', 'https://webphone2.sonax.cloud/widget?data=xyz&dataClient=103121');
    });

    it('rejeita URL de host que não é Sonax (anti-injeção)', async () => {
      repo.findMembership.mockResolvedValue(membership(OrgRole.AGENT) as any);
      await expect(
        service.updateMemberWebphone('org-1', 'membership-1', { webphoneUrl: 'https://evil.com/x.js' }),
      ).rejects.toBeTruthy();
      expect(repo.updateMemberWebphone).not.toHaveBeenCalled();
    });

    it('vazio limpa o webphone (null)', async () => {
      repo.findMembership.mockResolvedValue(membership(OrgRole.AGENT) as any);
      repo.updateMemberWebphone.mockResolvedValue({} as any);
      await service.updateMemberWebphone('org-1', 'membership-1', { webphoneUrl: '' });
      expect(repo.updateMemberWebphone).toHaveBeenCalledWith('membership-1', null);
    });

    it('getMyWebphone devolve a url do membership do usuário logado', async () => {
      repo.findMembership.mockResolvedValue({ ...membership(OrgRole.AGENT), sonaxWebphoneUrl: 'https://webphone2.sonax.cloud/widget?data=q' } as any);
      const out = await service.getMyWebphone('org-1', 'user-1');
      expect(out.webphoneUrl).toBe('https://webphone2.sonax.cloud/widget?data=q');
    });
  });

  describe('updateMemberRamal', () => {
    it('grava o ramal (trim) do membro encontrado', async () => {
      repo.findMembership.mockResolvedValue({ id: 'mem1' } as any);
      repo.updateMemberRamal.mockResolvedValue({ id: 'mem1', sonaxRamal: '101' } as any);
      const res = await service.updateMemberRamal('org1', 'mem1', { sonaxRamal: ' 101 ' });
      expect(repo.updateMemberRamal).toHaveBeenCalledWith('mem1', '101');
      expect(res.sonaxRamal).toBe('101');
    });

    it('vazio limpa o ramal (null)', async () => {
      repo.findMembership.mockResolvedValue({ id: 'mem1' } as any);
      repo.updateMemberRamal.mockResolvedValue({ id: 'mem1', sonaxRamal: null } as any);
      await service.updateMemberRamal('org1', 'mem1', { sonaxRamal: '' });
      expect(repo.updateMemberRamal).toHaveBeenCalledWith('mem1', null);
    });

    it('NotFound quando o membro não existe', async () => {
      repo.findMembership.mockResolvedValue(null);
      await expect(service.updateMemberRamal('org1', 'x', { sonaxRamal: '1' })).rejects.toBeTruthy();
    });
  });

  describe('updateMemberWorkingHours', () => {
    const workingHours = {
      monday: { enabled: true, windows: [['09:00', '18:00']] },
    };

    it('grava a agenda e o toggle do aviso do membro resolvido, escopado à org', async () => {
      repo.findMembership.mockResolvedValue({ id: 'mem1' } as any);
      repo.updateMemberWorkingHours.mockResolvedValue({
        id: 'mem1',
        workingHours,
        offHoursNoticeEnabled: true,
      } as any);

      const res = await service.updateMemberWorkingHours('org1', 'mem1', {
        workingHours,
        offHoursNoticeEnabled: true,
      });

      expect(repo.findMembership).toHaveBeenCalledWith('mem1', 'org1');
      expect(repo.updateMemberWorkingHours).toHaveBeenCalledWith('mem1', {
        workingHours,
        offHoursNoticeEnabled: true,
      });
      expect(res.offHoursNoticeEnabled).toBe(true);
    });

    it('aceita workingHours: null (desliga a agenda)', async () => {
      repo.findMembership.mockResolvedValue({ id: 'mem1' } as any);
      repo.updateMemberWorkingHours.mockResolvedValue({
        id: 'mem1',
        workingHours: null,
        offHoursNoticeEnabled: false,
      } as any);

      const res = await service.updateMemberWorkingHours('org1', 'mem1', {
        workingHours: null,
      });

      expect(repo.updateMemberWorkingHours).toHaveBeenCalledWith('mem1', {
        workingHours: null,
      });
      expect(res.workingHours).toBeNull();
    });

    it('só grava os campos informados (parcial)', async () => {
      repo.findMembership.mockResolvedValue({ id: 'mem1' } as any);
      repo.updateMemberWorkingHours.mockResolvedValue({ id: 'mem1' } as any);

      await service.updateMemberWorkingHours('org1', 'mem1', {
        offHoursNoticeEnabled: true,
      });

      expect(repo.updateMemberWorkingHours).toHaveBeenCalledWith('mem1', {
        offHoursNoticeEnabled: true,
      });
    });

    it('NotFound quando o membro não existe na org (evita escrita cross-org)', async () => {
      repo.findMembership.mockResolvedValue(null);
      await expect(
        service.updateMemberWorkingHours('org1', 'ghost', { workingHours }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.updateMemberWorkingHours).not.toHaveBeenCalled();
    });
  });
});
