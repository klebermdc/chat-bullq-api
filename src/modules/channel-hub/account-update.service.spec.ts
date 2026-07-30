import { AccountUpdateService } from './account-update.service';

describe('AccountUpdateService', () => {
  function make(channelOverrides: any = {}) {
    const prisma = { channel: { update: jest.fn().mockResolvedValue({}) } } as any;
    const notifications = { notifyOrgAgents: jest.fn().mockResolvedValue(undefined) } as any;
    const channel = {
      id: 'ch1',
      name: 'WhatsApp Comercial',
      organizationId: 'org1',
      isActive: true,
      ...channelOverrides,
    } as any;
    return { svc: new AccountUpdateService(prisma, notifications), prisma, notifications, channel };
  }

  it('PARTNER_REMOVED desativa o canal', async () => {
    const { svc, prisma, channel } = make();
    await svc.handle(channel, { event: 'PARTNER_REMOVED' });
    expect(prisma.channel.update).toHaveBeenCalledWith({
      where: { id: 'ch1' },
      data: { isActive: false },
    });
  });

  it('nao tenta desativar canal que ja esta inativo', async () => {
    const { svc, prisma, channel } = make({ isActive: false });
    await svc.handle(channel, { event: 'PARTNER_REMOVED' });
    expect(prisma.channel.update).not.toHaveBeenCalled();
  });

  it('evento nao-fatal NAO desativa, mas ainda avisa', async () => {
    const { svc, prisma, notifications, channel } = make();
    await svc.handle(channel, { event: 'PHONE_NUMBER_QUALITY_UPDATE', phoneNumber: '5511999' });
    expect(prisma.channel.update).not.toHaveBeenCalled();
    expect(notifications.notifyOrgAgents).toHaveBeenCalled();
  });

  it('avisa apenas OWNER e ADMIN — quem pode reconectar', async () => {
    const { svc, notifications, channel } = make();
    await svc.handle(channel, { event: 'PARTNER_REMOVED' });
    const arg = notifications.notifyOrgAgents.mock.calls[0][0];
    expect(arg.organizationId).toBe('org1');
    expect(arg.roles).toEqual(['OWNER', 'ADMIN']);
    expect(arg.data.channelId).toBe('ch1');
    expect(arg.data.event).toBe('PARTNER_REMOVED');
  });

  // A desativação é o que importa; falhar em notificar não pode desfazê-la.
  it('falha na notificacao nao derruba a desativacao', async () => {
    const { svc, prisma, notifications, channel } = make();
    notifications.notifyOrgAgents.mockRejectedValueOnce(new Error('smtp down'));
    await expect(svc.handle(channel, { event: 'PARTNER_REMOVED' })).resolves.toBeUndefined();
    expect(prisma.channel.update).toHaveBeenCalled();
  });
});
