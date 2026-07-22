import { OrgRole } from '@prisma/client';
import { AuthService } from './auth.service';

describe('AuthService.getMe → permissions', () => {
  function serviceWith(role: OrgRole) {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'a@b.com',
          name: 'Fulano',
          password: 'hash',
        }),
      },
      userOrganization: {
        findMany: jest.fn().mockResolvedValue([
          {
            role,
            organization: { id: 'o1', name: 'Org', slug: 'org' },
            channelAgents: [{ channelId: 'c1' }],
          },
        ]),
      },
    };
    // As demais dependências não são tocadas por getMe.
    return new AuthService(prisma, {} as any, {} as any);
  }

  it('AGENT recebe permissions sem settings.view', async () => {
    const res: any = await serviceWith(OrgRole.AGENT).getMe('u1');
    expect(res.organizations[0].permissions).toContain('inbox.view');
    expect(res.organizations[0].permissions).not.toContain('settings.view');
  });

  it('ADMIN recebe settings.view', async () => {
    const res: any = await serviceWith(OrgRole.ADMIN).getMe('u1');
    expect(res.organizations[0].permissions).toContain('settings.view');
  });
});
