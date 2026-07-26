import { ConflictException } from '@nestjs/common';
import { PlatformService } from './platform.service';
import { PlatformRepository } from './platform.repository';

describe('PlatformService.createOrganization', () => {
  let service: PlatformService;
  let repo: jest.Mocked<Pick<PlatformRepository,
    'findOrgBySlug' | 'findUserByEmail' | 'createOrgWithOwner'>>;

  beforeEach(() => {
    repo = {
      findOrgBySlug: jest.fn().mockResolvedValue(null),
      findUserByEmail: jest.fn().mockResolvedValue(null),
      createOrgWithOwner: jest.fn().mockResolvedValue({
        organization: { id: 'o1', name: 'Acme', slug: 'acme', plan: 'free' },
        user: { id: 'u1', name: 'Dona', email: 'dona@acme.com', password: 'x' },
      }),
    } as any;
    service = new PlatformService(repo as any);
  });

  const dto = {
    companyName: 'Acme', ownerName: 'Dona',
    ownerEmail: 'dona@acme.com', ownerPassword: 'password123',
  };

  it('creates org + owner and returns them without the password', async () => {
    const result = await service.createOrganization(dto as any);
    expect(repo.createOrgWithOwner).toHaveBeenCalledTimes(1);
    expect(result.organization).toMatchObject({ id: 'o1', slug: 'acme' });
    expect((result.owner as any).password).toBeUndefined();
    expect(result.owner).toMatchObject({ email: 'dona@acme.com' });
    const passed = repo.createOrgWithOwner.mock.calls[0][0];
    expect(passed.ownerPasswordHash).not.toBe('password123');
  });

  it('rejects a duplicate owner email', async () => {
    repo.findUserByEmail.mockResolvedValue({ id: 'existing' } as any);
    await expect(service.createOrganization(dto as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.createOrgWithOwner).not.toHaveBeenCalled();
  });

  it('rejects a slug collision', async () => {
    repo.findOrgBySlug.mockResolvedValue({ id: 'existing' } as any);
    await expect(service.createOrganization(dto as any)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repo.createOrgWithOwner).not.toHaveBeenCalled();
  });
});
