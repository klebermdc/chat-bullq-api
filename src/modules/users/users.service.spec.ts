import { ForbiddenException } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { UsersService } from './users.service';

function build(opts: { name: string; isSuperAdmin?: boolean; roles: OrgRole[] }) {
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'u1', name: opts.name, isSuperAdmin: !!opts.isSuperAdmin }),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'u1', name: opts.name, password: 'x', ...data })),
    },
    userOrganization: {
      count: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve(opts.roles.filter((r) => where.role.in.includes(r)).length),
      ),
    },
  } as any;
  return { svc: new UsersService(prisma), prisma };
}

describe('UsersService.updateProfile — nome travado para atendente', () => {
  it('blocks an agent from renaming themselves (o nome vincula o relatório de vendas)', async () => {
    const { svc, prisma } = build({ name: 'Suelen', roles: [OrgRole.AGENT] });
    await expect(svc.updateProfile('u1', { name: 'Marcella' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('lets an agent change only the avatar', async () => {
    const { svc, prisma } = build({ name: 'Suelen', roles: [OrgRole.AGENT] });
    await svc.updateProfile('u1', { avatarUrl: 'https://x/a.png' });
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('lets an agent resend the same name (formulário salva tudo junto)', async () => {
    const { svc, prisma } = build({ name: 'Suelen', roles: [OrgRole.AGENT] });
    await svc.updateProfile('u1', { name: 'Suelen', avatarUrl: 'https://x/a.png' });
    expect(prisma.user.update).toHaveBeenCalled();
  });

  it('lets an admin rename themselves', async () => {
    const { svc } = build({ name: 'Kleber', roles: [OrgRole.ADMIN] });
    const r = await svc.updateProfile('u1', { name: 'Kleber M' });
    expect(r.name).toBe('Kleber M');
  });

  it('never returns the password hash', async () => {
    const { svc } = build({ name: 'Kleber', roles: [OrgRole.OWNER] });
    const r: any = await svc.updateProfile('u1', { name: 'K' });
    expect(r.password).toBeUndefined();
  });
});
