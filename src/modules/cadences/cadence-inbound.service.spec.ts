import { CadenceInboundService } from './cadence-inbound.service';

function noHumanReply() {
  return {
    conversation: {
      findUnique: jest.fn(async () => ({ lastHumanReplyAt: null as Date | null })),
    },
  };
}

function makeDeps() {
  const enrollments = {
    findLiveByConversation: jest.fn(async () => ({
      id: 'enr1',
      organizationId: 'org1',
      cadenceId: 'cad1',
      conversationId: 'conv1',
      currentStep: 1,
      status: 'ACTIVE',
    })),
  };
  const cadences = {
    findById: jest.fn(async () => ({
      id: 'cad1',
      steps: [{ order: 1, options: ['SIM', 'NAO'] }],
    })),
  };
  const classifier = { classify: jest.fn(async () => 'ENGAGED') };
  const transition = { apply: jest.fn(async () => undefined) };
  const prisma = noHumanReply();
  const service = new CadenceInboundService(
    enrollments as any,
    cadences as any,
    classifier as any,
    transition as any,
    prisma as any,
  );
  return { service, enrollments, cadences, classifier, transition, prisma };
}

describe('CadenceInboundService — FIX 6 (inbound não-acionável)', () => {
  it('REACTION → no-op (não classifica nem aplica transição)', async () => {
    const { service, enrollments, classifier, transition } = makeDeps();
    await service.handleInbound('conv1', {
      type: 'REACTION',
      content: { text: '👍' },
    } as any);
    expect(enrollments.findLiveByConversation).not.toHaveBeenCalled();
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(transition.apply).not.toHaveBeenCalled();
  });

  it('SYSTEM → no-op', async () => {
    const { service, classifier, transition } = makeDeps();
    await service.handleInbound('conv1', {
      type: 'SYSTEM',
      content: {},
    } as any);
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(transition.apply).not.toHaveBeenCalled();
  });

  it('texto vazio/whitespace sem botão → no-op', async () => {
    const { service, classifier, transition } = makeDeps();
    await service.handleInbound('conv1', { content: { text: '   ' } } as any);
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(transition.apply).not.toHaveBeenCalled();
  });

  it('texto genuíno → classifica e aplica transição', async () => {
    const { service, classifier, transition } = makeDeps();
    await service.handleInbound('conv1', {
      content: { text: 'quero sim' },
    } as any);
    expect(classifier.classify).toHaveBeenCalledTimes(1);
    expect(transition.apply).toHaveBeenCalledTimes(1);
  });

  it('botão nativo mesmo sem texto → é acionável', async () => {
    const { service, classifier, transition } = makeDeps();
    await service.handleInbound('conv1', {
      metadata: { buttonId: 'SIM' },
      content: {},
    } as any);
    expect(classifier.classify).toHaveBeenCalledTimes(1);
    expect(transition.apply).toHaveBeenCalledTimes(1);
  });
});

describe('CadenceInboundService — NO_REPLY (reengajamento de entrada)', () => {
  it('NO_REPLY: resposta comum → RESUMED (Aline reassume), sem classificar Sim/Não como handoff', async () => {
    const { service, enrollments, cadences, classifier, transition } =
      makeDeps();
    enrollments.findLiveByConversation.mockResolvedValue({
      id: 'e1',
      cadenceId: 'cad',
      currentStep: 1,
      organizationId: 'org1',
    } as any);
    cadences.findById.mockResolvedValue({
      id: 'cad',
      trigger: 'NO_REPLY',
      steps: [{ order: 1 }],
    } as any);
    classifier.classify.mockResolvedValue('AMBIGUO');

    await service.handleInbound('c1', {
      content: { text: 'oi, ainda quero sim' },
    } as any);

    expect(transition.apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1' }),
      'RESUMED',
      expect.anything(),
    );
  });

  it('NO_REPLY: opt-out → DESCADASTRAR', async () => {
    const { service, enrollments, cadences, classifier, transition } =
      makeDeps();
    enrollments.findLiveByConversation.mockResolvedValue({
      id: 'e1',
      cadenceId: 'cad',
      currentStep: 1,
      organizationId: 'org1',
    } as any);
    cadences.findById.mockResolvedValue({
      id: 'cad',
      trigger: 'NO_REPLY',
      steps: [{ order: 1 }],
    } as any);
    classifier.classify.mockResolvedValue('DESCADASTRAR');

    await service.handleInbound('c1', {
      content: { text: 'parar' },
    } as any);

    expect(transition.apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'e1' }),
      'DESCADASTRAR',
      expect.anything(),
    );
  });
});

describe('CadenceInboundService — reclassificação live (ACTIVE|PAUSED)', () => {
  it('usa findLiveByConversation (acha também PAUSED) para reclassificar', async () => {
    const enrollments = {
      findLiveByConversation: jest.fn().mockResolvedValue({
        id: 'e1',
        cadenceId: 'cad1',
        organizationId: 'o1',
        currentStep: 2,
        status: 'PAUSED',
      }),
    };
    const cadences = {
      findById: jest.fn().mockResolvedValue({
        id: 'cad1',
        trigger: 'BOTH',
        steps: [{ order: 2, options: ['SIM', 'NAO'] }],
      }),
    };
    const classifier = { classify: jest.fn().mockResolvedValue('SIM') };
    const transition = { apply: jest.fn() };
    const svc = new CadenceInboundService(
      enrollments as any,
      cadences as any,
      classifier as any,
      transition as any,
      noHumanReply() as any,
    );

    await svc.handleInbound('c1', {
      content: { text: 'sim, quero' },
      metadata: {},
    } as any);

    expect(enrollments.findLiveByConversation).toHaveBeenCalledWith('c1');
    expect(transition.apply).toHaveBeenCalled();
  });

  it('NO_REPLY continua indo para RESUMED (não pausa)', async () => {
    const enrollments = {
      findLiveByConversation: jest.fn().mockResolvedValue({
        id: 'e1',
        cadenceId: 'cad1',
        organizationId: 'o1',
        status: 'ACTIVE',
      }),
    };
    const cadences = {
      findById: jest.fn().mockResolvedValue({
        id: 'cad1',
        trigger: 'NO_REPLY',
        steps: [],
      }),
    };
    const classifier = { classify: jest.fn().mockResolvedValue('AMBIGUO') };
    const transition = { apply: jest.fn() };
    const svc = new CadenceInboundService(
      enrollments as any,
      cadences as any,
      classifier as any,
      transition as any,
      noHumanReply() as any,
    );
    await svc.handleInbound('c1', {
      content: { text: 'oi de novo' },
      metadata: {},
    } as any);
    expect(transition.apply).toHaveBeenCalledWith(
      expect.anything(),
      'RESUMED',
      expect.anything(),
    );
  });
});

describe('CadenceInboundService — vendedor já assumiu a conversa', () => {
  const LAST_TOUCH = new Date('2026-11-10T12:00:00Z');

  function arrange(opts: {
    status: 'ACTIVE' | 'PAUSED';
    lastHumanReplyAt: Date | null;
    pausedAt?: Date | null;
    trigger?: string;
  }) {
    const deps = makeDeps();
    deps.enrollments.findLiveByConversation.mockResolvedValue({
      id: 'enr1',
      organizationId: 'org1',
      cadenceId: 'cad1',
      conversationId: 'conv1',
      currentStep: 1,
      status: opts.status,
      startedAt: new Date('2026-11-09T12:00:00Z'),
      lastStepAt: LAST_TOUCH,
      pausedAt: opts.pausedAt ?? null,
    } as any);
    if (opts.trigger) {
      deps.cadences.findById.mockResolvedValue({
        id: 'cad1',
        trigger: opts.trigger,
        steps: [{ order: 1, options: ['SIM', 'NAO'] }],
      } as any);
    }
    deps.prisma.conversation.findUnique.mockResolvedValue({
      lastHumanReplyAt: opts.lastHumanReplyAt,
    });
    deps.classifier.classify.mockResolvedValue('SIM' as any);
    return deps;
  }

  it('cadência PAUSED e vendedor respondeu depois da pausa → encerra calada, sem classificar', async () => {
    // Arrange: caso Natália — cliente respondeu, cadência pausou e passou para
    // a Marcella, que seguiu conversando.
    const pausedAt = new Date('2026-11-10T13:00:00Z');
    const { service, classifier, transition } = arrange({
      status: 'PAUSED',
      pausedAt,
      lastHumanReplyAt: new Date('2026-11-11T00:44:00Z'),
    });

    // Act
    await service.handleInbound('conv1', {
      content: { text: 'Em qualquer um dos parques?' },
    } as any);

    // Assert
    expect(classifier.classify).not.toHaveBeenCalled();
    expect(transition.apply).toHaveBeenCalledTimes(1);
    expect(transition.apply).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'enr1' }),
      'SELLER_TOOK_OVER',
      expect.anything(),
    );
  });

  it('cadência ACTIVE e vendedor respondeu depois do último toque → encerra calada', async () => {
    const { service, classifier, transition } = arrange({
      status: 'ACTIVE',
      lastHumanReplyAt: new Date('2026-11-10T15:00:00Z'),
    });

    await service.handleInbound('conv1', { content: { text: 'sim' } } as any);

    expect(classifier.classify).not.toHaveBeenCalled();
    expect(transition.apply).toHaveBeenCalledWith(
      expect.anything(),
      'SELLER_TOOK_OVER',
      expect.anything(),
    );
  });

  it('reengajamento (NO_REPLY) também respeita o vendedor', async () => {
    const { service, classifier, transition } = arrange({
      status: 'ACTIVE',
      trigger: 'NO_REPLY',
      lastHumanReplyAt: new Date('2026-11-10T15:00:00Z'),
    });

    await service.handleInbound('conv1', { content: { text: 'oi' } } as any);

    expect(classifier.classify).not.toHaveBeenCalled();
    expect(transition.apply).toHaveBeenCalledWith(
      expect.anything(),
      'SELLER_TOOK_OVER',
      expect.anything(),
    );
  });

  it('humano respondeu ANTES do último toque → segue o fluxo normal da cadência', async () => {
    const { service, classifier, transition } = arrange({
      status: 'ACTIVE',
      lastHumanReplyAt: new Date('2026-11-10T11:00:00Z'),
    });

    await service.handleInbound('conv1', { content: { text: 'sim' } } as any);

    expect(classifier.classify).toHaveBeenCalledTimes(1);
    expect(transition.apply).toHaveBeenCalledWith(
      expect.anything(),
      'SIM',
      expect.anything(),
    );
  });

  it('nenhum humano respondeu → segue o fluxo normal da cadência', async () => {
    const { service, classifier, transition } = arrange({
      status: 'ACTIVE',
      lastHumanReplyAt: null,
    });

    await service.handleInbound('conv1', { content: { text: 'sim' } } as any);

    expect(classifier.classify).toHaveBeenCalledTimes(1);
    expect(transition.apply).toHaveBeenCalledWith(
      expect.anything(),
      'SIM',
      expect.anything(),
    );
  });
});
