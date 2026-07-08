import { CadenceTransitionService } from './cadence-transition.service';

function makePrisma(conversation: any = { id: 'conv1', assignedToId: 'seller1' }) {
  return {
    conversation: {
      findUnique: jest.fn(async () => conversation),
      update: jest.fn(async () => ({})),
    },
    card: { update: jest.fn(async () => ({})) },
    conversationTag: { create: jest.fn(async () => ({})) },
    contactTag: { create: jest.fn(async () => ({})) },
  } as any;
}

function makeDeps(conversation?: any) {
  const runner = { stop: jest.fn(async () => undefined) };
  const prisma = makePrisma(conversation);
  const notifications = {
    notify: jest.fn(async () => ({})),
    notifyOrgAgents: jest.fn(async () => ({})),
  };
  const service = new CadenceTransitionService(
    runner as any,
    prisma,
    notifications as any,
  );
  return { runner, prisma, notifications, service };
}

const enrollment = (overrides: any = {}) => ({
  id: 'enr1',
  organizationId: 'org1',
  conversationId: 'conv1',
  contactId: 'contact1',
  cardId: 'card1',
  status: 'ACTIVE',
  ...overrides,
});

const cadence = (overrides: any = {}) => ({
  id: 'cad1',
  hotTagId: 'tag-hot',
  lostStageId: 'stage-lost',
  optOutTagId: 'tag-optout',
  ...overrides,
});

describe('CadenceTransitionService', () => {
  it('SIM → stop(replied_yes) + tag quente na conversa + assign + notifica', async () => {
    const { runner, prisma, notifications, service } = makeDeps();
    await service.apply(enrollment(), 'SIM', cadence());

    expect(runner.stop).toHaveBeenCalledWith('enr1', 'replied_yes');
    expect(prisma.conversationTag.create).toHaveBeenCalledWith({
      data: { conversationId: 'conv1', tagId: 'tag-hot' },
    });
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    expect((notifications.notify.mock.calls[0] as any[])[0].recipientId).toBe(
      'seller1',
    );
  });

  it('SIM sem hotTagId → não aplica tag, mas ainda assign + notifica', async () => {
    const { runner, prisma, notifications, service } = makeDeps();
    await service.apply(enrollment(), 'SIM', cadence({ hotTagId: null }));

    expect(runner.stop).toHaveBeenCalledWith('enr1', 'replied_yes');
    expect(prisma.conversationTag.create).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('ENGAGED → stop(engaged) + assign + notifica, SEM tag quente', async () => {
    const { runner, prisma, notifications, service } = makeDeps();
    await service.apply(enrollment(), 'ENGAGED', cadence());

    expect(runner.stop).toHaveBeenCalledWith('enr1', 'engaged');
    expect(prisma.conversationTag.create).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('AMBIGUO → tratado como engajou (stop engaged + notifica, sem tag)', async () => {
    const { runner, prisma, notifications, service } = makeDeps();
    await service.apply(enrollment(), 'AMBIGUO', cadence());

    expect(runner.stop).toHaveBeenCalledWith('enr1', 'engaged');
    expect(prisma.conversationTag.create).not.toHaveBeenCalled();
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('handoff sem vendedor atribuído → notifica os agentes do org', async () => {
    const { notifications, service } = makeDeps({ id: 'conv1', assignedToId: null });
    await service.apply(enrollment(), 'ENGAGED', cadence());

    expect(notifications.notify).not.toHaveBeenCalled();
    expect(notifications.notifyOrgAgents).toHaveBeenCalledTimes(1);
  });

  it('NAO → stop(said_no) + move o card para lostStageId', async () => {
    const { runner, prisma, notifications, service } = makeDeps();
    await service.apply(enrollment(), 'NAO', cadence());

    expect(runner.stop).toHaveBeenCalledWith('enr1', 'said_no');
    expect(prisma.card.update).toHaveBeenCalledTimes(1);
    const arg = prisma.card.update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: 'card1' });
    expect(arg.data.stageId).toBe('stage-lost');
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('NAO sem lostStageId → não move card', async () => {
    const { prisma, service } = makeDeps();
    await service.apply(enrollment(), 'NAO', cadence({ lostStageId: null }));
    expect(prisma.card.update).not.toHaveBeenCalled();
  });

  it('NAO sem cardId no enrollment → não move card', async () => {
    const { prisma, service } = makeDeps();
    await service.apply(enrollment({ cardId: null }), 'NAO', cadence());
    expect(prisma.card.update).not.toHaveBeenCalled();
  });

  it('DESCADASTRAR → stop(opt_out) + tag opt-out no CONTATO', async () => {
    const { runner, prisma, service } = makeDeps();
    await service.apply(enrollment(), 'DESCADASTRAR', cadence());

    expect(runner.stop).toHaveBeenCalledWith('enr1', 'opt_out');
    expect(prisma.contactTag.create).toHaveBeenCalledWith({
      data: { contactId: 'contact1', tagId: 'tag-optout' },
    });
    expect(prisma.conversationTag.create).not.toHaveBeenCalled();
  });

  it('EXHAUSTED → move card para lostStageId (runner já parou, não chama stop)', async () => {
    const { runner, prisma, service } = makeDeps();
    await service.apply(enrollment(), 'EXHAUSTED', cadence());

    expect(runner.stop).not.toHaveBeenCalled();
    expect(prisma.card.update).toHaveBeenCalledTimes(1);
    expect(prisma.card.update.mock.calls[0][0].data.stageId).toBe('stage-lost');
  });

  it('idempotência: enrollment não-ACTIVE → no-op total', async () => {
    const { runner, prisma, notifications, service } = makeDeps();
    await service.apply(enrollment({ status: 'HANDED_OFF' }), 'SIM', cadence());

    expect(runner.stop).not.toHaveBeenCalled();
    expect(prisma.conversationTag.create).not.toHaveBeenCalled();
    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(notifications.notifyOrgAgents).not.toHaveBeenCalled();
  });

  it('tag já aplicada (P2002) não propaga erro', async () => {
    const { service, prisma } = makeDeps();
    const p2002 = Object.assign(new Error('dup'), { code: 'P2002' });
    Object.setPrototypeOf(
      p2002,
      require('@prisma/client').Prisma.PrismaClientKnownRequestError.prototype,
    );
    prisma.conversationTag.create.mockRejectedValueOnce(p2002);
    await expect(service.apply(enrollment(), 'SIM', cadence())).resolves.toBeUndefined();
  });
});
