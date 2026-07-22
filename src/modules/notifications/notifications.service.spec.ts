import { NotificationType, OrgRole } from '@prisma/client';
import { NotificationsService } from './notifications.service';

function make() {
  const repository = {
    create: jest.fn(async (d: any) => ({ id: 'n1', ...d })),
  } as any;
  const prisma = {
    userOrganization: {
      findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]),
    },
  } as any;
  const queue = { add: jest.fn().mockResolvedValue(undefined) } as any;
  return { svc: new NotificationsService(repository, prisma, queue), prisma, repository };
}

const base = {
  organizationId: 'org1',
  type: NotificationType.AI_TOOL_FAILURE,
  title: 't',
  body: 'b',
};

describe('NotificationsService.notifyOrgAgents', () => {
  it('sem roles, notifica a org inteira (alertas operacionais)', async () => {
    const { svc, prisma, repository } = make();
    await svc.notifyOrgAgents({ ...base, type: NotificationType.SLA_BREACH });

    expect(prisma.userOrganization.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org1' },
      select: { userId: true },
    });
    expect(repository.create).toHaveBeenCalledTimes(2);
  });

  it('com roles, filtra os destinatários por papel', async () => {
    const { svc, prisma } = make();
    await svc.notifyOrgAgents({ ...base, roles: [OrgRole.OWNER, OrgRole.ADMIN] });

    expect(prisma.userOrganization.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org1',
        role: { in: [OrgRole.OWNER, OrgRole.ADMIN] },
      },
      select: { userId: true },
    });
  });

  it('roles vazio equivale a não filtrar', async () => {
    const { svc, prisma } = make();
    await svc.notifyOrgAgents({ ...base, roles: [] });

    expect(prisma.userOrganization.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org1' },
      select: { userId: true },
    });
  });

  it('excludeUserId continua removendo o autor da ação', async () => {
    const { svc, repository } = make();
    await svc.notifyOrgAgents({ ...base, excludeUserId: 'u1' });

    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ recipientId: 'u2' }),
    );
  });
});
