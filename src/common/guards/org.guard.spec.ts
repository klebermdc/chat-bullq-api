import { ForbiddenException } from '@nestjs/common';
import { OrgGuard } from './org.guard';

function ctx() {
  const req: any = { headers: { 'x-organization-id': 'o1' }, user: { id: 'u1' } };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => null,
    getClass: () => null,
  } as any;
}

function build(membership: any) {
  const prisma = {
    userOrganization: { findUnique: jest.fn().mockResolvedValue(membership) },
  } as any;
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) } as any;
  const channelAccess = { getAccessibleChannelIds: jest.fn().mockResolvedValue([]) } as any;
  return new OrgGuard(prisma, reflector, channelAccess);
}

const membershipBase = {
  id: 'm1',
  organizationId: 'o1',
  role: 'OWNER',
  organization: { id: 'o1', name: 'Acme', slug: 'acme', suspendedAt: null },
};

describe('OrgGuard suspension', () => {
  it('blocks access when the organization is suspended', async () => {
    const guard = build({
      ...membershipBase,
      organization: { ...membershipBase.organization, suspendedAt: new Date() },
    });
    await expect(guard.canActivate(ctx())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows access when suspendedAt is null', async () => {
    const guard = build(membershipBase);
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
  });
});
