import { CadenceRunner } from './cadence-runner.service';

function makeCadence(overrides: any = {}) {
  return {
    id: 'cad1',
    organizationId: 'org1',
    trigger: 'BOTH',
    enabled: true,
    lostStageId: 'stage-lost',
    optOutTagId: null,
    steps: [
      {
        id: 'st1',
        order: 1,
        delayMinutes: 24,
        contentType: 'TEXT',
        content: { text: 'Oi, {nome}! Tudo bem?' },
        options: ['SIM', 'NAO'],
        templateId: null,
      },
      {
        id: 'st2',
        order: 2,
        delayMinutes: 72,
        contentType: 'TEXT',
        content: { text: 'Oi de novo, {nome}!' },
        options: ['SIM', 'NAO'],
        templateId: null,
      },
    ],
    ...overrides,
  };
}

function makeDeps(opts: any = {}) {
  const enrollmentsStore: any[] = [];
  let enrSeq = 0;
  const enrollments = {
    create: jest.fn(async (data: any) => {
      const e = { id: `enr${++enrSeq}`, ...data };
      enrollmentsStore.push(e);
      return e;
    }),
    findById: jest.fn(
      async (id: string) => enrollmentsStore.find((e) => e.id === id) ?? null,
    ),
    findActiveByConversation: jest.fn(
      async (cid: string) =>
        enrollmentsStore.find(
          (e) => e.conversationId === cid && e.status === 'ACTIVE',
        ) ?? null,
    ),
    // Guarda de idempotência do `start`: enrollment PAUSED também ocupa a
    // conversa (o índice único parcial cobre ACTIVE+PAUSED).
    findLiveByConversation: jest.fn(
      async (cid: string) =>
        enrollmentsStore.find(
          (e) =>
            e.conversationId === cid &&
            (e.status === 'ACTIVE' || e.status === 'PAUSED'),
        ) ?? null,
    ),
    update: jest.fn(async (id: string, data: any) => {
      const e = enrollmentsStore.find((x) => x.id === id);
      Object.assign(e, data);
      return e;
    }),
    // FIX 4: compare-and-set — só "vence" se ainda ACTIVE.
    finishIfActive: jest.fn(async (id: string, data: any) => {
      const e = enrollmentsStore.find((x) => x.id === id);
      if (!e || e.status !== 'ACTIVE') return false;
      Object.assign(e, data);
      return true;
    }),
    // Task 6: encerra a partir de ACTIVE **ou** PAUSED (segunda resposta na pausa).
    finishIfLive: jest.fn(async (id: string, data: any) => {
      const e = enrollmentsStore.find((x) => x.id === id);
      if (!e || (e.status !== 'ACTIVE' && e.status !== 'PAUSED')) return false;
      Object.assign(e, data);
      return true;
    }),
  };

  const theCadence = opts.cadence ?? makeCadence();
  const cadences = {
    findById: jest.fn(async () => theCadence),
    findByStage: jest.fn(async () => opts.byStage ?? null),
    findNoReply: jest.fn(async () => opts.noReply ?? null),
  };

  let smSeq = 0;
  const schedRepo = {
    create: jest.fn(async (data: any) => ({
      id: `sm${++smSeq}`,
      status: 'PENDING',
      ...data,
    })),
    update: jest.fn(async (id: string, data: any) => ({ id, ...data })),
  };
  const scheduledMessages = {
    cancelPendingForConversation: jest.fn(async () => 0),
  };
  const queue = { add: jest.fn(async () => ({ id: 'job-1' })) };
  const silenceQueue = { add: jest.fn(async () => ({ id: 'siljob-1' })) };
  const realtime = { emitToConversation: jest.fn() };
  const prisma = {
    conversation: {
      findUnique: jest.fn(async (): Promise<any> => ({
        id: 'conv1',
        organizationId: 'org1',
        channelId: 'ch1',
        contactId: 'ct1',
      })),
    },
    contact: {
      findUnique: jest.fn(async () => ({ id: 'ct1', name: 'Maria' })),
    },
    contactTag: {
      findUnique: jest.fn(async () =>
        opts.hasOptOut ? { contactId: 'ct1', tagId: 'opt1' } : null,
      ),
    },
    card: {
      findFirst: jest.fn(async (): Promise<any> => ({ id: 'card1' })),
      update: jest.fn(async () => ({})),
      create: jest.fn(async () => ({ id: 'card-new' })),
    },
    pipelineStage: {
      findUnique: jest.fn(async (): Promise<any> => null),
    },
    userOrganization: {
      findFirst: jest.fn(async () => ({ userId: 'owner1' })),
    },
    aiPendingAction: {
      findFirst: jest.fn(async (): Promise<any> => null),
    },
    // Por padrão toda inscrição viva tem toque pendente (não é zumbi).
    scheduledMessage: {
      count: jest.fn(async () => 1),
    },
  };

  const runner = new CadenceRunner(
    enrollments as any,
    cadences as any,
    schedRepo as any,
    scheduledMessages as any,
    prisma as any,
    queue as any,
    realtime as any,
    silenceQueue as any,
  );

  return {
    runner,
    enrollments,
    enrollmentsStore,
    cadences,
    schedRepo,
    scheduledMessages,
    queue,
    silenceQueue,
    realtime,
    prisma,
  };
}

describe('CadenceRunner.start', () => {
  it('cria enrollment ACTIVE e agenda o passo 1 (origin CADENCE, jobId sem ":")', async () => {
    const { runner, enrollments, schedRepo, queue, realtime } = makeDeps();

    const enrollment = await runner.start('conv1', 'cad1', 'MANUAL');

    expect(enrollment).toBeTruthy();
    expect(enrollments.create).toHaveBeenCalledTimes(1);
    const created = (enrollments.create.mock.calls[0] as any[])[0];
    expect(created).toMatchObject({
      organizationId: 'org1',
      cadenceId: 'cad1',
      conversationId: 'conv1',
      contactId: 'ct1',
      cardId: 'card1',
      currentStep: 1,
      status: 'ACTIVE',
    });

    // Passo 1 agendado como ScheduledMessage CADENCE.
    expect(schedRepo.create).toHaveBeenCalledTimes(1);
    const sm = (schedRepo.create.mock.calls[0] as any[])[0];
    expect(sm.origin).toBe('CADENCE');
    expect(sm.cadenceStepOrder).toBe(1);
    expect(sm.cadenceEnrollmentId).toBe(enrollment!.id);
    // Regressão: precisa de remetente de sistema (senão dispatch falha no_sender).
    expect(sm.createdById).toBe('owner1');
    expect(sm.content).toEqual({ text: 'Oi, Maria! Tudo bem?\n\n1 - Sim\n2 - Não' });
    expect(sm.scheduledAt.getTime()).toBeGreaterThan(Date.now());

    // Enfileirado com jobId sem ':' (regressão BullMQ).
    expect(queue.add).toHaveBeenCalledTimes(1);
    const jobOpts = (queue.add.mock.calls[0] as any[])[2];
    expect(String(jobOpts.jobId)).not.toContain(':');
    expect(schedRepo.update).toHaveBeenCalledWith(
      'sm1',
      expect.objectContaining({ jobId: expect.any(String) }),
    );

    expect(realtime.emitToConversation).toHaveBeenCalledWith(
      'conv1',
      'cadence:started',
      expect.anything(),
    );
  });

  it('idempotente: já existe enrollment ACTIVE para a cadência → não cria outro', async () => {
    const { runner, enrollments, enrollmentsStore, schedRepo } = makeDeps();
    enrollmentsStore.push({
      id: 'enr-existing',
      conversationId: 'conv1',
      cadenceId: 'cad1',
      status: 'ACTIVE',
    });

    const result = await runner.start('conv1', 'cad1', 'MANUAL');

    expect(result!.id).toBe('enr-existing');
    expect(enrollments.create).not.toHaveBeenCalled();
    expect(schedRepo.create).not.toHaveBeenCalled();
  });

  it('FIX 3: já existe enrollment ACTIVE de OUTRA cadência → devolve o existente, não cria', async () => {
    const { runner, enrollments, enrollmentsStore, schedRepo } = makeDeps();
    enrollmentsStore.push({
      id: 'enr-other',
      conversationId: 'conv1',
      cadenceId: 'cad-outra',
      status: 'ACTIVE',
    });

    const result = await runner.start('conv1', 'cad1', 'MANUAL');

    expect(result!.id).toBe('enr-other');
    expect(enrollments.create).not.toHaveBeenCalled();
    expect(schedRepo.create).not.toHaveBeenCalled();
  });

  it('FIX 1: orgId não bate com a cadência → ForbiddenException', async () => {
    const { runner, enrollments } = makeDeps();
    await expect(
      runner.start('conv1', 'cad1', 'MANUAL', 'org-outra'),
    ).rejects.toThrow('cadence_not_in_org');
    expect(enrollments.create).not.toHaveBeenCalled();
  });

  it('FIX 1: MANUAL com allowManual=false → BadRequestException', async () => {
    const { runner, enrollments } = makeDeps({
      cadence: makeCadence({ allowManual: false }),
    });
    await expect(
      runner.start('conv1', 'cad1', 'MANUAL', 'org1'),
    ).rejects.toThrow('cadence_manual_not_allowed');
    expect(enrollments.create).not.toHaveBeenCalled();
  });

  it('FIX 1: cadência desabilitada via endpoint manual → BadRequestException', async () => {
    const { runner, enrollments } = makeDeps({
      cadence: makeCadence({ enabled: false }),
    });
    await expect(
      runner.start('conv1', 'cad1', 'MANUAL', 'org1'),
    ).rejects.toThrow('cadence_disabled');
    expect(enrollments.create).not.toHaveBeenCalled();
  });

  it('FIX 1: MANUAL válido com org + allowManual + enabled → cria', async () => {
    const { runner, enrollments } = makeDeps({
      cadence: makeCadence({ allowManual: true, enabled: true }),
    });
    const enrollment = await runner.start('conv1', 'cad1', 'MANUAL', 'org1');
    expect(enrollment).toBeTruthy();
    expect(enrollments.create).toHaveBeenCalledTimes(1);
  });

  // Regressão: o índice único parcial cobre ACTIVE+PAUSED. Se a guarda de
  // idempotência só olhasse ACTIVE, um enrollment PAUSED (revive armado) caía
  // no `create` e estourava P2002 — reentrar na etapa gatilho virava erro.
  it('enrollment PAUSED na conversa → devolve o existente, não cria outro', async () => {
    const { runner, enrollments, enrollmentsStore, schedRepo } = makeDeps();
    enrollmentsStore.push({
      id: 'enrPaused',
      organizationId: 'org1',
      cadenceId: 'cad1',
      conversationId: 'conv1',
      contactId: 'ct1',
      currentStep: 2,
      status: 'PAUSED',
    });

    const result = await runner.start('conv1', 'cad1', 'MANUAL', 'org1');

    expect(result).toMatchObject({ id: 'enrPaused', status: 'PAUSED' });
    expect(enrollments.create).not.toHaveBeenCalled();
    expect(schedRepo.create).not.toHaveBeenCalled();
  });

  it('opt-out: contato tem a tag de opt-out → pula (retorna null)', async () => {
    const { runner, enrollments, schedRepo } = makeDeps({
      cadence: makeCadence({ optOutTagId: 'opt1' }),
      hasOptOut: true,
    });

    const result = await runner.start('conv1', 'cad1', 'MANUAL');

    expect(result).toBeNull();
    expect(enrollments.create).not.toHaveBeenCalled();
    expect(schedRepo.create).not.toHaveBeenCalled();
  });
});

describe('CadenceRunner.onStepSent', () => {
  it('com próximo passo → agenda o próximo e avança currentStep', async () => {
    const { runner, enrollments, enrollmentsStore, schedRepo, realtime } =
      makeDeps();
    enrollmentsStore.push({
      id: 'enr1',
      organizationId: 'org1',
      cadenceId: 'cad1',
      conversationId: 'conv1',
      contactId: 'ct1',
      cardId: 'card1',
      currentStep: 1,
      status: 'ACTIVE',
    });

    await runner.onStepSent('enr1', 1);

    expect(schedRepo.create).toHaveBeenCalledTimes(1);
    const sm = (schedRepo.create.mock.calls[0] as any[])[0];
    expect(sm.cadenceStepOrder).toBe(2);
    expect(sm.content).toEqual({ text: 'Oi de novo, Maria!\n\n1 - Sim\n2 - Não' });
    expect(enrollments.update).toHaveBeenCalledWith(
      'enr1',
      expect.objectContaining({ currentStep: 2 }),
    );
    expect(realtime.emitToConversation).toHaveBeenCalledWith(
      'conv1',
      'cadence:step',
      expect.anything(),
    );
  });

  it('no último passo → COMPLETED_NO_REPLY + move card para lostStageId', async () => {
    const { runner, enrollments, enrollmentsStore, schedRepo, prisma, realtime } =
      makeDeps();
    enrollmentsStore.push({
      id: 'enr1',
      organizationId: 'org1',
      cadenceId: 'cad1',
      conversationId: 'conv1',
      contactId: 'ct1',
      cardId: 'card1',
      currentStep: 2,
      status: 'ACTIVE',
    });

    await runner.onStepSent('enr1', 2);

    expect(schedRepo.create).not.toHaveBeenCalled();
    expect(enrollments.finishIfActive).toHaveBeenCalledWith(
      'enr1',
      expect.objectContaining({ status: 'COMPLETED_NO_REPLY' }),
    );
    expect(prisma.card.update).toHaveBeenCalledTimes(1);
    expect((prisma.card.update.mock.calls[0] as any[])[0].data.stageId).toBe(
      'stage-lost',
    );
    expect(realtime.emitToConversation).toHaveBeenCalledWith(
      'conv1',
      'cadence:completed',
      expect.anything(),
    );
  });

  it('no último passo, SEM cardId (lead pré-humano) → cria card em lostStageId ao invés de mover', async () => {
    const { runner, enrollments, enrollmentsStore, schedRepo, prisma, realtime } =
      makeDeps();
    prisma.pipelineStage.findUnique.mockResolvedValue({
      id: 'stage-lost',
      pipelineId: 'pl1',
    });
    prisma.contact.findUnique.mockResolvedValue({ id: 'ct1', name: 'Fulano' });
    enrollmentsStore.push({
      id: 'enr1',
      organizationId: 'org1',
      cadenceId: 'cad1',
      conversationId: 'conv1',
      contactId: 'ct1',
      cardId: null,
      currentStep: 2,
      status: 'ACTIVE',
    });

    await runner.onStepSent('enr1', 2);

    expect(schedRepo.create).not.toHaveBeenCalled();
    expect(enrollments.finishIfActive).toHaveBeenCalledWith(
      'enr1',
      expect.objectContaining({ status: 'COMPLETED_NO_REPLY' }),
    );
    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(prisma.pipelineStage.findUnique).toHaveBeenCalledWith({
      where: { id: 'stage-lost' },
    });
    expect(prisma.card.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org1',
        pipelineId: 'pl1',
        stageId: 'stage-lost',
        conversationId: 'conv1',
        contactId: 'ct1',
        title: 'Fulano',
        status: 'LOST',
      }),
    });
    expect(realtime.emitToConversation).toHaveBeenCalledWith(
      'conv1',
      'cadence:completed',
      expect.anything(),
    );
  });

  it('enrollment não-ACTIVE → no-op', async () => {
    const { runner, enrollmentsStore, schedRepo, enrollments } = makeDeps();
    enrollmentsStore.push({
      id: 'enr1',
      cadenceId: 'cad1',
      conversationId: 'conv1',
      currentStep: 1,
      status: 'HANDED_OFF',
    });

    await runner.onStepSent('enr1', 1);

    expect(schedRepo.create).not.toHaveBeenCalled();
    expect(enrollments.update).not.toHaveBeenCalled();
  });
});

describe('CadenceRunner.stop', () => {
  it('cancela pendentes CADENCE e grava status/endReason (said_no → MOVED_LOST)', async () => {
    const { runner, enrollments, enrollmentsStore, scheduledMessages, realtime } =
      makeDeps();
    enrollmentsStore.push({
      id: 'enr1',
      organizationId: 'org1',
      conversationId: 'conv1',
      currentStep: 1,
      status: 'ACTIVE',
    });

    await runner.stop('enr1', 'said_no');

    expect(enrollments.finishIfLive).toHaveBeenCalledWith(
      'enr1',
      expect.objectContaining({ status: 'MOVED_LOST', endReason: 'said_no' }),
    );
    expect(scheduledMessages.cancelPendingForConversation).toHaveBeenCalledWith(
      'conv1',
      'said_no',
      'CADENCE',
    );
    expect(realtime.emitToConversation).toHaveBeenCalledWith(
      'conv1',
      'cadence:stopped',
      expect.anything(),
    );
  });

  it('FIX 1: stop com orgId de outro tenant → ForbiddenException', async () => {
    const { runner, enrollments, enrollmentsStore } = makeDeps();
    enrollmentsStore.push({
      id: 'enr1',
      organizationId: 'org1',
      conversationId: 'conv1',
      currentStep: 1,
      status: 'ACTIVE',
    });
    await expect(runner.stop('enr1', 'manual_handoff', 'org-outra')).rejects.toThrow(
      'enrollment_not_in_org',
    );
    expect(enrollments.finishIfLive).not.toHaveBeenCalled();
  });

  it('FIX 4: enrollment já não-ACTIVE → não reivindica nem cancela pendentes', async () => {
    const { runner, enrollments, enrollmentsStore, scheduledMessages } = makeDeps();
    enrollmentsStore.push({
      id: 'enr1',
      organizationId: 'org1',
      conversationId: 'conv1',
      currentStep: 1,
      status: 'HANDED_OFF',
    });
    await runner.stop('enr1', 'said_no');
    expect(enrollments.finishIfLive).not.toHaveBeenCalled();
    expect(scheduledMessages.cancelPendingForConversation).not.toHaveBeenCalled();
  });

  it('mapeia reason → status (replied_yes/manual_handoff → HANDED_OFF, opt_out → STOPPED_OPTOUT)', async () => {
    for (const [reason, status] of [
      ['replied_yes', 'HANDED_OFF'],
      ['engaged', 'HANDED_OFF'],
      ['manual_handoff', 'HANDED_OFF'],
      ['opt_out', 'STOPPED_OPTOUT'],
    ] as const) {
      const { runner, enrollments, enrollmentsStore } = makeDeps();
      enrollmentsStore.push({
        id: 'enr1',
        organizationId: 'org1',
        conversationId: 'conv1',
        currentStep: 1,
        status: 'ACTIVE',
      });
      await runner.stop('enr1', reason);
      expect(enrollments.finishIfLive).toHaveBeenCalledWith(
        'enr1',
        expect.objectContaining({ status }),
      );
    }
  });

  it('stop("client_replied") encerra com status RESUMED_AI', async () => {
    const { runner, enrollments, enrollmentsStore } = makeDeps();
    enrollmentsStore.push({
      id: 'enr1',
      organizationId: 'org1',
      conversationId: 'conv1',
      currentStep: 1,
      status: 'ACTIVE',
    });

    await runner.stop('enr1', 'client_replied');

    expect(enrollments.finishIfLive).toHaveBeenCalledWith(
      'enr1',
      expect.objectContaining({
        status: 'RESUMED_AI',
        endReason: 'client_replied',
      }),
    );
  });
});

describe('CadenceRunner.maybeStartForStage', () => {
  it('cadência habilitada com trigger STAGE_ENTER/BOTH → chama start', async () => {
    const { runner, cadences, enrollments } = makeDeps({
      byStage: makeCadence({ trigger: 'STAGE_ENTER' }),
    });

    await runner.maybeStartForStage('conv1', 'card1', 'stage1', 'org1');

    expect(cadences.findByStage).toHaveBeenCalledWith('org1', 'stage1');
    expect(enrollments.create).toHaveBeenCalledTimes(1);
  });

  it('trigger MANUAL → não inicia', async () => {
    const { runner, enrollments } = makeDeps({
      byStage: makeCadence({ trigger: 'MANUAL' }),
    });

    await runner.maybeStartForStage('conv1', 'card1', 'stage1', 'org1');

    expect(enrollments.create).not.toHaveBeenCalled();
  });

  it('nenhuma cadência para a etapa → no-op', async () => {
    const { runner, enrollments } = makeDeps({ byStage: null });

    await runner.maybeStartForStage('conv1', 'card1', 'stage1', 'org1');

    expect(enrollments.create).not.toHaveBeenCalled();
  });
});

describe('CadenceRunner.maybeStartForNoReply', () => {
  const PERGUNTA = 'Quais parques você quer visitar?';
  const conv = {
    id: 'c1',
    organizationId: 'org1',
    assignedToId: null,
    awaitingHumanReply: false,
  };

  it('inscreve quando pré-humano, cadência NO_REPLY enabled e card em etapa monitorada', async () => {
    const { runner, cadences, prisma } = makeDeps();
    prisma.conversation.findUnique.mockResolvedValue(conv);
    prisma.card.findFirst.mockResolvedValue({ id: 'card1', stageId: 'st-coletando' });
    cadences.findNoReply.mockResolvedValue(
      makeCadence({
        id: 'cad-nr',
        trigger: 'NO_REPLY',
        enabled: true,
        watchedStageIds: ['st-coletando'],
        steps: [
          { order: 1, delayMinutes: 180, contentType: 'TEXT', content: {}, options: [] },
        ],
      }),
    );
    const startSpy = jest
      .spyOn(runner, 'start')
      .mockResolvedValue({ id: 'e1' } as any);

    const result = await runner.maybeStartForNoReply('c1', PERGUNTA);

    expect(startSpy).toHaveBeenCalledWith('c1', 'cad-nr', 'NO_REPLY');
    expect(result).toEqual({ id: 'e1' });
  });

  // Regressão 2026-11-01: toda mensagem do cliente liga awaitingHumanReply e a
  // resposta da Aline não desliga, então a cadência nunca inscreveu ninguém.
  it('inscreve mesmo com awaitingHumanReply=true (flag ligado pela msg do cliente)', async () => {
    const { runner, cadences, prisma } = makeDeps();
    prisma.conversation.findUnique.mockResolvedValue({ ...conv, awaitingHumanReply: true });
    cadences.findNoReply.mockResolvedValue(
      makeCadence({ id: 'cad-nr', trigger: 'NO_REPLY', enabled: true, watchedStageIds: [] }),
    );
    const startSpy = jest.spyOn(runner, 'start').mockResolvedValue({ id: 'e1' } as any);

    await runner.maybeStartForNoReply('c1', PERGUNTA);

    expect(startSpy).toHaveBeenCalledWith('c1', 'cad-nr', 'NO_REPLY');
  });

  it('NÃO inscreve quando a Aline não fez pergunta (despedida, aviso de transferência)', async () => {
    const { runner, cadences, prisma } = makeDeps();
    prisma.conversation.findUnique.mockResolvedValue(conv);
    cadences.findNoReply.mockResolvedValue(
      makeCadence({ id: 'cad-nr', trigger: 'NO_REPLY', enabled: true, watchedStageIds: [] }),
    );
    const startSpy = jest.spyOn(runner, 'start').mockResolvedValue({ id: 'e1' } as any);

    const result = await runner.maybeStartForNoReply('c1', 'Perfeito, já tenho tudo que preciso 😊');

    expect(startSpy).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('NÃO inscreve quando há transferência aguardando distribuição', async () => {
    const { runner, cadences, prisma } = makeDeps();
    prisma.conversation.findUnique.mockResolvedValue(conv);
    prisma.aiPendingAction.findFirst.mockResolvedValue({ id: 'pa1' });
    cadences.findNoReply.mockResolvedValue(
      makeCadence({ id: 'cad-nr', trigger: 'NO_REPLY', enabled: true, watchedStageIds: [] }),
    );
    const startSpy = jest.spyOn(runner, 'start').mockResolvedValue({ id: 'e1' } as any);

    const result = await runner.maybeStartForNoReply('c1', PERGUNTA);

    expect(startSpy).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('NÃO inscreve em conversa encerrada', async () => {
    const { runner, cadences, prisma } = makeDeps();
    prisma.conversation.findUnique.mockResolvedValue({ ...conv, status: 'CLOSED' });
    cadences.findNoReply.mockResolvedValue(
      makeCadence({ id: 'cad-nr', trigger: 'NO_REPLY', enabled: true, watchedStageIds: [] }),
    );
    const startSpy = jest.spyOn(runner, 'start').mockResolvedValue({ id: 'e1' } as any);

    await runner.maybeStartForNoReply('c1', PERGUNTA);

    expect(startSpy).not.toHaveBeenCalled();
  });

  it('NÃO inscreve quando a IA foi desligada na conversa (aiEnabled=false)', async () => {
    const { runner, cadences, prisma } = makeDeps();
    prisma.conversation.findUnique.mockResolvedValue({ ...conv, aiEnabled: false });
    cadences.findNoReply.mockResolvedValue(
      makeCadence({ id: 'cad-nr', trigger: 'NO_REPLY', enabled: true, watchedStageIds: [] }),
    );
    const startSpy = jest.spyOn(runner, 'start').mockResolvedValue({ id: 'e1' } as any);

    const result = await runner.maybeStartForNoReply('c1', PERGUNTA);

    expect(startSpy).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('NÃO inscreve quando a conversa já foi para um humano (assignedToId setado)', async () => {
    const { runner, cadences, prisma } = makeDeps();
    prisma.conversation.findUnique.mockResolvedValue({
      ...conv,
      assignedToId: 'user1',
    });
    cadences.findNoReply.mockResolvedValue(
      makeCadence({
        id: 'cad-nr',
        trigger: 'NO_REPLY',
        enabled: true,
        watchedStageIds: [],
      }),
    );
    const startSpy = jest
      .spyOn(runner, 'start')
      .mockResolvedValue({ id: 'e1' } as any);

    const result = await runner.maybeStartForNoReply('c1', PERGUNTA);

    expect(startSpy).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('NÃO inscreve quando o card está fora das etapas monitoradas', async () => {
    const { runner, cadences, prisma } = makeDeps();
    prisma.conversation.findUnique.mockResolvedValue(conv);
    prisma.card.findFirst.mockResolvedValue({ id: 'card1', stageId: 'st-proposta' });
    cadences.findNoReply.mockResolvedValue(
      makeCadence({
        id: 'cad-nr',
        trigger: 'NO_REPLY',
        enabled: true,
        watchedStageIds: ['st-coletando'],
      }),
    );
    const startSpy = jest
      .spyOn(runner, 'start')
      .mockResolvedValue({ id: 'e1' } as any);

    const result = await runner.maybeStartForNoReply('c1', PERGUNTA);

    expect(startSpy).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('no-op quando não há cadência NO_REPLY habilitada', async () => {
    const { runner, cadences, prisma } = makeDeps();
    prisma.conversation.findUnique.mockResolvedValue(conv);
    cadences.findNoReply.mockResolvedValue(null);
    const startSpy = jest
      .spyOn(runner, 'start')
      .mockResolvedValue({ id: 'e1' } as any);

    const result = await runner.maybeStartForNoReply('c1', PERGUNTA);

    expect(startSpy).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});

describe('CadenceRunner.pause', () => {
  it('pausa (ACTIVE→PAUSED), cancela toques pendentes e arma o watchdog', async () => {
    const enrollments = {
      pauseIfActive: jest.fn().mockResolvedValue(true),
      findById: jest.fn().mockResolvedValue({ id: 'e1', conversationId: 'c1' }),
    };
    const scheduledMessages = { cancelPendingForConversation: jest.fn().mockResolvedValue(0) };
    const silenceQueue = { add: jest.fn().mockResolvedValue({ id: 'j1' }) };
    const realtime = { emitToConversation: jest.fn() };
    const runner: any = new CadenceRunner(
      enrollments as any, {} as any, {} as any, scheduledMessages as any,
      {} as any, {} as any, realtime as any, silenceQueue as any,
    );

    const res = await runner.pause('e1', 1440);

    expect(res).toEqual({ id: 'e1', conversationId: 'c1' });
    expect(scheduledMessages.cancelPendingForConversation)
      .toHaveBeenCalledWith('c1', 'paused_weak_reply', 'CADENCE');
    expect(silenceQueue.add).toHaveBeenCalledWith(
      'check-cadence-silence',
      { enrollmentId: 'e1' },
      expect.objectContaining({ delay: 1440 * 60_000 }),
    );
    expect(realtime.emitToConversation).toHaveBeenCalledWith('c1', 'cadence:paused', { enrollmentId: 'e1' });
  });

  it('não faz nada se perdeu o claim (não estava ACTIVE)', async () => {
    const enrollments = { pauseIfActive: jest.fn().mockResolvedValue(false) };
    const silenceQueue = { add: jest.fn() };
    const runner: any = new CadenceRunner(
      enrollments as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, { emitToConversation: jest.fn() } as any, silenceQueue as any,
    );
    expect(await runner.pause('e1', 1440)).toBeNull();
    expect(silenceQueue.add).not.toHaveBeenCalled();
  });
});

describe('CadenceRunner.resumeAtStep', () => {
  it('retoma (PAUSED→ACTIVE) e agenda o passo atual no dispatchAt', async () => {
    const dispatchAt = new Date('2026-07-16T11:00:00Z');
    const enrollments = {
      resumeIfPaused: jest.fn().mockResolvedValue(true),
      findById: jest.fn().mockResolvedValue({
        id: 'e1', conversationId: 'c1', contactId: 'ct1', cadenceId: 'cad1', currentStep: 2,
      }),
    };
    const cadences = {
      findById: jest.fn().mockResolvedValue({
        id: 'cad1', steps: [
          { order: 1, delayMinutes: 1440, contentType: 'TEXT', content: { text: 'a' } },
          { order: 2, delayMinutes: 4320, contentType: 'TEXT', content: { text: 'b' }, options: ['SIM', 'NAO'] },
        ],
      }),
    };
    const prisma = {
      conversation: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', organizationId: 'o1', channelId: 'ch1', assignedToId: 'u1' }) },
      contact: { findUnique: jest.fn().mockResolvedValue({ name: 'Ana' }) },
    };
    const schedRepo = { create: jest.fn().mockResolvedValue({ id: 'sm1' }), update: jest.fn() };
    const dispatchQueue = { add: jest.fn().mockResolvedValue({ id: 'j2' }) };
    const realtime = { emitToConversation: jest.fn() };
    const runner: any = new CadenceRunner(
      enrollments as any, cadences as any, schedRepo as any, {} as any,
      prisma as any, dispatchQueue as any, realtime as any, {} as any,
    );

    await runner.resumeAtStep('e1', dispatchAt);

    expect(schedRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ cadenceStepOrder: 2, scheduledAt: dispatchAt }),
    );
    expect(realtime.emitToConversation).toHaveBeenCalledWith('c1', 'cadence:resumed', { enrollmentId: 'e1', currentStep: 2 });
  });

  it('não retoma se perdeu o claim', async () => {
    const enrollments = { resumeIfPaused: jest.fn().mockResolvedValue(false) };
    const schedRepo = { create: jest.fn() };
    const runner: any = new CadenceRunner(
      enrollments as any, {} as any, schedRepo as any, {} as any,
      {} as any, {} as any, { emitToConversation: jest.fn() } as any, {} as any,
    );
    await runner.resumeAtStep('e1', new Date());
    expect(schedRepo.create).not.toHaveBeenCalled();
  });
});

describe('CadenceRunner.resumeNow', () => {
  /** Runner com só o `findById` do enrollment mockado + resumeAtStep espionado. */
  function makeRunner(enrollment: any) {
    const enrollments = {
      findById: jest.fn().mockResolvedValue(enrollment),
      resumeIfPaused: jest.fn().mockResolvedValue(false),
    };
    const runner: any = new CadenceRunner(
      enrollments as any, {} as any, {} as any, {} as any,
      {} as any, {} as any, { emitToConversation: jest.fn() } as any, {} as any,
    );
    jest.spyOn(runner, 'resumeAtStep').mockResolvedValue(undefined);
    return runner;
  }

  const paused = {
    id: 'e1',
    organizationId: 'org1',
    status: 'PAUSED',
  };

  it('PAUSED da própria org → chama resumeAtStep', async () => {
    const runner = makeRunner(paused);
    await runner.resumeNow('e1', 'org1');
    expect(runner.resumeAtStep).toHaveBeenCalledWith('e1', expect.any(Date));
  });

  it('respeita quiet hours: às 23h BRT agenda pra 8h, não pra agora', async () => {
    const runner = makeRunner(paused);
    // 2026-07-22 23:30 BRT == 2026-07-23 02:30Z
    jest.useFakeTimers().setSystemTime(new Date('2026-07-23T02:30:00Z'));
    await runner.resumeNow('e1', 'org1');
    const [, dispatchAt] = (runner.resumeAtStep as jest.Mock).mock.calls[0];
    // 8h BRT do dia seguinte == 11:00Z
    expect(dispatchAt.toISOString()).toBe('2026-07-23T11:00:00.000Z');
    jest.useRealTimers();
  });

  it('enrollment de outra org → ForbiddenException', async () => {
    const runner = makeRunner(paused);
    await expect(runner.resumeNow('e1', 'orgX')).rejects.toThrow(
      'enrollment_not_in_org',
    );
    expect(runner.resumeAtStep).not.toHaveBeenCalled();
  });

  it('enrollment ACTIVE (não pausado) → BadRequestException', async () => {
    const runner = makeRunner({ ...paused, status: 'ACTIVE' });
    await expect(runner.resumeNow('e1', 'org1')).rejects.toThrow(
      'enrollment_not_paused',
    );
    expect(runner.resumeAtStep).not.toHaveBeenCalled();
  });

  it('enrollment inexistente → NotFoundException', async () => {
    const runner = makeRunner(null);
    await expect(runner.resumeNow('e1', 'org1')).rejects.toThrow(
      'enrollment_not_found',
    );
  });
});

describe('CadenceRunner — saída do reengajamento (NO_REPLY)', () => {
  const noReply = () =>
    makeCadence({ id: 'cad-nr', trigger: 'NO_REPLY', lostStageId: 'stage-lista' });
  const enrollment = {
    id: 'enr1',
    organizationId: 'org1',
    cadenceId: 'cad-nr',
    conversationId: 'conv1',
    contactId: 'ct1',
    cardId: 'card1',
    currentStep: 2,
    status: 'ACTIVE',
  };

  it('último toque: NÃO encerra na hora, agenda a saída para 1 dia depois', async () => {
    const { runner, cadences, enrollments, enrollmentsStore, silenceQueue, prisma } = makeDeps();
    cadences.findById.mockResolvedValue(noReply());
    enrollmentsStore.push({ ...enrollment });

    await runner.onStepSent('enr1', 2);

    expect(enrollments.finishIfActive).not.toHaveBeenCalled();
    expect(prisma.card.update).not.toHaveBeenCalled();
    expect(silenceQueue.add).toHaveBeenCalledWith(
      'cadence-no-reply-exit',
      { enrollmentId: 'enr1' },
      expect.objectContaining({
        delay: 1440 * 60_000,
        jobId: expect.stringMatching(/^cadexit-enr1-\d+$/),
      }),
    );
  });

  it('passado o dia: encerra e deixa o card ABERTO na etapa NORMAL (não é venda perdida)', async () => {
    const { runner, cadences, enrollments, enrollmentsStore, prisma } = makeDeps();
    cadences.findById.mockResolvedValue(noReply());
    prisma.pipelineStage.findUnique.mockResolvedValue({ id: 'stage-lista', pipelineId: 'pl1', type: 'NORMAL' });
    enrollmentsStore.push({ ...enrollment });

    await runner.exitNoReply('enr1');

    expect(enrollments.finishIfActive).toHaveBeenCalledWith(
      'enr1',
      expect.objectContaining({ status: 'COMPLETED_NO_REPLY' }),
    );
    expect(prisma.card.update).toHaveBeenCalledWith({
      where: { id: 'card1' },
      data: { stageId: 'stage-lista', status: 'OPEN', closedAt: null },
    });
  });

  it('cliente respondeu durante a espera: a saída vira no-op', async () => {
    const { runner, cadences, enrollments, enrollmentsStore, prisma } = makeDeps();
    cadences.findById.mockResolvedValue(noReply());
    enrollmentsStore.push({ ...enrollment, status: 'RESUMED_AI' });

    await runner.exitNoReply('enr1');

    expect(enrollments.finishIfActive).not.toHaveBeenCalled();
    expect(prisma.card.update).not.toHaveBeenCalled();
  });

  it('etapa de saída LOST continua fechando o card como perdido', async () => {
    const { runner, enrollmentsStore, prisma } = makeDeps();
    prisma.pipelineStage.findUnique.mockResolvedValue({ id: 'stage-lost', pipelineId: 'pl1', type: 'LOST' });
    enrollmentsStore.push({ ...enrollment, cadenceId: 'cad1' });

    await runner.onStepSent('enr1', 2);

    expect((prisma.card.update.mock.calls[0] as any[])[0].data).toEqual(
      expect.objectContaining({ stageId: 'stage-lost', status: 'LOST', closedAt: expect.any(Date) }),
    );
  });

  it('toque do reengajamento que cairia de madrugada vai para as 8h', async () => {
    const { runner, cadences, enrollmentsStore, schedRepo } = makeDeps();
    cadences.findById.mockResolvedValue(
      makeCadence({
        id: 'cad-nr',
        trigger: 'NO_REPLY',
        steps: [{ order: 1, delayMinutes: 180, contentType: 'TEXT', content: { text: 'oi' }, options: [] }],
      }),
    );
    enrollmentsStore.length = 0;
    const spy = jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-11-02T02:00:00.000Z').getTime()); // 23h BRT

    await runner.start('conv1', 'cad-nr', 'NO_REPLY');
    spy.mockRestore();

    expect(schedRepo.create.mock.calls[0][0].scheduledAt).toEqual(new Date('2026-11-02T11:00:00.000Z')); // 8h BRT
  });
});

describe('CadenceRunner.start — inscrição zumbi', () => {
  const old = new Date(Date.now() - 3 * 24 * 3600_000);
  const zumbi = {
    id: 'enrZ',
    organizationId: 'org1',
    cadenceId: 'cad1',
    conversationId: 'conv1',
    contactId: 'ct1',
    currentStep: 1,
    status: 'ACTIVE',
    startedAt: old,
    lastStepAt: old,
  };

  it('ACTIVE antiga sem toque pendente é encerrada e não bloqueia a nova cadência', async () => {
    const { runner, enrollments, enrollmentsStore, prisma } = makeDeps();
    enrollmentsStore.push({ ...zumbi });
    prisma.scheduledMessage.count.mockResolvedValue(0);

    const result = await runner.start('conv1', 'cad1', 'STAGE_ENTER');

    expect(enrollments.finishIfLive).toHaveBeenCalledWith(
      'enrZ',
      expect.objectContaining({ status: 'HANDED_OFF', endReason: 'stale' }),
    );
    expect(enrollments.create).toHaveBeenCalled();
    expect(result?.id).not.toBe('enrZ');
  });

  it('ACTIVE recente sem toque pendente (entre um passo e outro) continua valendo', async () => {
    const { runner, enrollments, enrollmentsStore, prisma } = makeDeps();
    enrollmentsStore.push({ ...zumbi, lastStepAt: new Date() });
    prisma.scheduledMessage.count.mockResolvedValue(0);

    const result = await runner.start('conv1', 'cad1', 'STAGE_ENTER');

    expect(enrollments.create).not.toHaveBeenCalled();
    expect(result?.id).toBe('enrZ');
  });
});
