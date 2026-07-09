import { CadenceTransitionService } from './cadence-transition.service';

function makePrisma(
  conversation: any = {
    id: 'conv1',
    organizationId: 'org1',
    contactId: 'contact1',
    assignedToId: 'seller1',
  },
) {
  return {
    conversation: {
      findUnique: jest.fn(async () => conversation),
      update: jest.fn(async () => ({})),
    },
    contact: { findUnique: jest.fn(async () => ({ name: 'Maria' })) },
    userOrganization: {
      findFirst: jest.fn(async () => ({ userId: 'owner1' })),
    },
    card: { update: jest.fn(async () => ({})) },
    conversationTag: { create: jest.fn(async () => ({})) },
    contactTag: { create: jest.fn(async () => ({})) },
  } as any;
}

function makeDeps(conversation?: any) {
  // FIX 4: stop devolve o enrollment (truthy) quando venceu o compare-and-set;
  // os efeitos da transição só rodam quando o claim vence.
  const runner = { stop: jest.fn(async () => ({ id: 'enr1' })) };
  const prisma = makePrisma(conversation);
  const notifications = {
    notify: jest.fn(async () => ({})),
    notifyOrgAgents: jest.fn(async () => ({})),
  };
  const messages = { send: jest.fn(async (..._args: any[]) => ({})) };
  const service = new CadenceTransitionService(
    runner as any,
    prisma,
    notifications as any,
    messages as any,
  );
  return { runner, prisma, notifications, messages, service };
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

  it('FIX 4: claim perdido (stop devolve null) → nenhum efeito colateral', async () => {
    const { runner, prisma, notifications, service } = makeDeps();
    runner.stop.mockResolvedValueOnce(null as any); // outro caminho já finalizou
    await service.apply(enrollment(), 'SIM', cadence());

    expect(runner.stop).toHaveBeenCalledWith('enr1', 'replied_yes');
    expect(prisma.conversationTag.create).not.toHaveBeenCalled();
    expect(notifications.notify).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it('SIM com onYesMessage → envia mensagem ({nome} resolvido) antes do handoff', async () => {
    const { messages, notifications, service } = makeDeps();
    await service.apply(
      enrollment(),
      'SIM',
      cadence({ onYesMessage: 'Perfeito, {nome}! Já te encaminho.' }),
    );

    expect(messages.send).toHaveBeenCalledTimes(1);
    const [dto, senderId, orgId, access] = messages.send.mock.calls[0];
    expect(dto).toEqual({
      conversationId: 'conv1',
      type: 'TEXT',
      content: { text: 'Perfeito, Maria! Já te encaminho.' },
    });
    expect(senderId).toBe('seller1');
    expect(orgId).toBe('org1');
    expect(access).toBe('ALL');
    // Enviou antes do handoff (que dispara a notificação ao vendedor).
    expect(notifications.notify).toHaveBeenCalledTimes(1);
    const sendOrder = messages.send.mock.invocationCallOrder[0];
    const notifyOrder = notifications.notify.mock.invocationCallOrder[0];
    expect(sendOrder).toBeLessThan(notifyOrder);
  });

  it('SIM sem onYesMessage → não envia mensagem de transição', async () => {
    const { messages, service } = makeDeps();
    await service.apply(enrollment(), 'SIM', cadence());
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('SIM com onYesMessage vazio → não envia', async () => {
    const { messages, service } = makeDeps();
    await service.apply(enrollment(), 'SIM', cadence({ onYesMessage: '' }));
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('SIM sem sender (nenhum responsável nem OWNER) → não envia mas aplica efeitos', async () => {
    const { messages, prisma, notifications, service } = makeDeps({
      id: 'conv1',
      organizationId: 'org1',
      contactId: 'contact1',
      assignedToId: null,
    });
    prisma.userOrganization.findFirst.mockResolvedValueOnce(null);
    await service.apply(
      enrollment(),
      'SIM',
      cadence({ onYesMessage: 'Oi {nome}' }),
    );
    expect(messages.send).not.toHaveBeenCalled();
    // Handoff ainda aconteceu (sem vendedor → agentes do org).
    expect(notifications.notifyOrgAgents).toHaveBeenCalledTimes(1);
  });

  it('SIM: falha no envio não bloqueia a transição', async () => {
    const { messages, notifications, service } = makeDeps();
    messages.send.mockRejectedValueOnce(new Error('provider down'));
    await expect(
      service.apply(
        enrollment(),
        'SIM',
        cadence({ onYesMessage: 'Oi {nome}' }),
      ),
    ).resolves.toBeUndefined();
    expect(notifications.notify).toHaveBeenCalledTimes(1);
  });

  it('NAO com onNoMessage → envia mensagem antes de mover o card p/ perdido', async () => {
    const { messages, prisma, service } = makeDeps();
    await service.apply(
      enrollment(),
      'NAO',
      cadence({ onNoMessage: 'Tudo bem, {nome}! Obrigado.' }),
    );

    expect(messages.send).toHaveBeenCalledTimes(1);
    expect(messages.send.mock.calls[0][0].content.text).toBe(
      'Tudo bem, Maria! Obrigado.',
    );
    expect(prisma.card.update).toHaveBeenCalledTimes(1);
    const sendOrder = messages.send.mock.invocationCallOrder[0];
    const cardOrder = prisma.card.update.mock.invocationCallOrder[0];
    expect(sendOrder).toBeLessThan(cardOrder);
  });

  it('DESCADASTRAR → não envia mensagem de transição', async () => {
    const { messages, service } = makeDeps();
    await service.apply(
      enrollment(),
      'DESCADASTRAR',
      cadence({ onYesMessage: 'x', onNoMessage: 'y' }),
    );
    expect(messages.send).not.toHaveBeenCalled();
  });

  it('SIM com claim perdido → não envia mensagem de transição', async () => {
    const { messages, runner, service } = makeDeps();
    runner.stop.mockResolvedValueOnce(null as any);
    await service.apply(
      enrollment(),
      'SIM',
      cadence({ onYesMessage: 'Oi {nome}' }),
    );
    expect(messages.send).not.toHaveBeenCalled();
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
