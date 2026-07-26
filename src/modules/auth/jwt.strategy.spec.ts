import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy.validate', () => {
  const config = { get: () => 'test-secret' } as unknown as ConfigService;

  function build(user: any) {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(user) } } as any;
    return new JwtStrategy(config, prisma);
  }

  it('includes isSuperAdmin in the returned user', async () => {
    const strategy = build({
      id: 'u1', email: 'a@b.com', name: 'A', avatarUrl: null,
      isActive: true, isSuperAdmin: true,
    });
    const result = await strategy.validate({ sub: 'u1', email: 'a@b.com' });
    expect(result).toEqual({
      id: 'u1', email: 'a@b.com', name: 'A', avatarUrl: null, isSuperAdmin: true,
    });
  });

  it('rejects inactive users', async () => {
    const strategy = build({ id: 'u1', isActive: false, isSuperAdmin: false });
    await expect(strategy.validate({ sub: 'u1', email: 'a@b.com' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
