import { CadenceInboundService } from './cadence-inbound.service';

function makeDeps() {
  const enrollments = {
    findActiveByConversation: jest.fn(async () => ({
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
  const service = new CadenceInboundService(
    enrollments as any,
    cadences as any,
    classifier as any,
    transition as any,
  );
  return { service, enrollments, cadences, classifier, transition };
}

describe('CadenceInboundService — FIX 6 (inbound não-acionável)', () => {
  it('REACTION → no-op (não classifica nem aplica transição)', async () => {
    const { service, enrollments, classifier, transition } = makeDeps();
    await service.handleInbound('conv1', {
      type: 'REACTION',
      content: { text: '👍' },
    } as any);
    expect(enrollments.findActiveByConversation).not.toHaveBeenCalled();
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
    enrollments.findActiveByConversation.mockResolvedValue({
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
    enrollments.findActiveByConversation.mockResolvedValue({
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
