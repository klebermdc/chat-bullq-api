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
  };

  const theCadence = opts.cadence ?? makeCadence();
  const cadences = {
    findById: jest.fn(async () => theCadence),
    findByStage: jest.fn(async () => opts.byStage ?? null),
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
  const realtime = { emitToConversation: jest.fn() };
  const prisma = {
    conversation: {
      findUnique: jest.fn(async () => ({
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
      findFirst: jest.fn(async () => ({ id: 'card1' })),
      update: jest.fn(async () => ({})),
    },
    userOrganization: {
      findFirst: jest.fn(async () => ({ userId: 'owner1' })),
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
  );

  return {
    runner,
    enrollments,
    enrollmentsStore,
    cadences,
    schedRepo,
    scheduledMessages,
    queue,
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

    expect(enrollments.finishIfActive).toHaveBeenCalledWith(
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
    expect(enrollments.finishIfActive).not.toHaveBeenCalled();
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
    expect(enrollments.finishIfActive).not.toHaveBeenCalled();
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
      expect(enrollments.finishIfActive).toHaveBeenCalledWith(
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

    expect(enrollments.finishIfActive).toHaveBeenCalledWith(
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
