import { NotificationType, OrgRole } from '@prisma/client';
import { ResponseSlaNotifier } from './response-sla.notifier';
import type { SlaContext, SlaRecord } from './response-sla.types';

const ctx = (patch: Partial<SlaContext> = {}): SlaContext => ({
  conversationId: 'c1',
  organizationId: 'org1',
  assignedToId: 'agent1',
  contactName: 'Ana',
  isWaiting: true,
  slaMinutes: 15,
  tz: 'America/Sao_Paulo',
  hours: null,
  ...patch,
});

const record: SlaRecord = {
  id: 'r1',
  organizationId: 'org1',
  conversationId: 'c1',
  agentId: 'agent1',
  slaMinutes: 15,
  waitingSince: new Date('2026-11-09T13:00:00Z'),
  dueAt: new Date('2026-11-09T13:15:00Z'),
  warnedAt: null,
  breached: false,
  respondedAt: null,
  endedAt: null,
};

function setup(online: Array<{ userId: string; role: OrgRole }> = []) {
  const notifications = { notify: jest.fn().mockResolvedValue({}) };
  const repository = { listOnlineMembers: jest.fn().mockResolvedValue(online) };
  const notifier = new ResponseSlaNotifier(notifications as any, repository as any);
  return { notifier, notifications, repository };
}

describe('ResponseSlaNotifier', () => {
  it('aviso vai só para o dono, com o tempo de espera', async () => {
    const { notifier, notifications, repository } = setup();

    await notifier.warn(ctx(), record, 8);

    expect(repository.listOnlineMembers).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'agent1',
        type: NotificationType.SLA_WARNING,
        body: 'Ana está esperando há 8 min.',
        data: expect.objectContaining({ conversationId: 'c1', slaType: 'response' }),
      }),
    );
  });

  it('aviso sem dono não sai', async () => {
    const { notifier, notifications } = setup();

    await notifier.warn(ctx({ assignedToId: null }), record, 8);

    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('estouro vai para o dono e ADM/Owner online', async () => {
    const { notifier, notifications } = setup([
      { userId: 'adm', role: OrgRole.ADMIN },
      { userId: 'peer', role: OrgRole.AGENT },
    ]);

    await notifier.breach(ctx(), record, 15);

    const recipients = notifications.notify.mock.calls.map((c) => c[0].recipientId);
    expect(recipients).toEqual(['agent1', 'adm']);
    expect(notifications.notify.mock.calls[0][0].type).toBe(NotificationType.SLA_BREACH);
  });

  it('estouro sem dono vai para todos os online', async () => {
    const { notifier, notifications } = setup([
      { userId: 'adm', role: OrgRole.ADMIN },
      { userId: 'peer', role: OrgRole.AGENT },
    ]);

    await notifier.breach(ctx({ assignedToId: null }), record, 15);

    const recipients = notifications.notify.mock.calls.map((c) => c[0].recipientId);
    expect(recipients).toEqual(['adm', 'peer']);
  });
});
