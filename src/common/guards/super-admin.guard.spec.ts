import { ForbiddenException } from '@nestjs/common';
import { SuperAdminGuard } from './super-admin.guard';

function ctx(user: any) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('SuperAdminGuard', () => {
  const guard = new SuperAdminGuard();

  it('allows a super admin', () => {
    expect(guard.canActivate(ctx({ id: 'u1', isSuperAdmin: true }))).toBe(true);
  });

  it('rejects a non-super-admin', () => {
    expect(() => guard.canActivate(ctx({ id: 'u1', isSuperAdmin: false }))).toThrow(
      ForbiddenException,
    );
  });

  it('rejects when there is no user', () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });
});
